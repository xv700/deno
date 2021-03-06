// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.
const { test } = Deno;
import { assert, assertEquals, assertThrowsAsync } from "../testing/asserts.ts";
import { LogLevel, getLevelName, getLevelByName } from "./levels.ts";
import { BaseHandler, FileHandler, RotatingFileHandler } from "./handlers.ts";
import { LogRecord } from "./logger.ts";
import { existsSync } from "../fs/exists.ts";

const LOG_FILE = "./test_log.file";

class TestHandler extends BaseHandler {
  public messages: string[] = [];

  public log(str: string): void {
    this.messages.push(str);
  }
}

test(function simpleHandler(): void {
  const cases = new Map<number, string[]>([
    [
      LogLevel.DEBUG,
      [
        "DEBUG debug-test",
        "INFO info-test",
        "WARNING warning-test",
        "ERROR error-test",
        "CRITICAL critical-test",
      ],
    ],
    [
      LogLevel.INFO,
      [
        "INFO info-test",
        "WARNING warning-test",
        "ERROR error-test",
        "CRITICAL critical-test",
      ],
    ],
    [
      LogLevel.WARNING,
      ["WARNING warning-test", "ERROR error-test", "CRITICAL critical-test"],
    ],
    [LogLevel.ERROR, ["ERROR error-test", "CRITICAL critical-test"]],
    [LogLevel.CRITICAL, ["CRITICAL critical-test"]],
  ]);

  for (const [testCase, messages] of cases.entries()) {
    const testLevel = getLevelName(testCase);
    const handler = new TestHandler(testLevel);

    for (const levelName in LogLevel) {
      const level = getLevelByName(levelName);
      handler.handle(
        new LogRecord(`${levelName.toLowerCase()}-test`, [], level)
      );
    }

    assertEquals(handler.level, testCase);
    assertEquals(handler.levelName, testLevel);
    assertEquals(handler.messages, messages);
  }
});

test(function testFormatterAsString(): void {
  const handler = new TestHandler("DEBUG", {
    formatter: "test {levelName} {msg}",
  });

  handler.handle(new LogRecord("Hello, world!", [], LogLevel.DEBUG));

  assertEquals(handler.messages, ["test DEBUG Hello, world!"]);
});

test(function testFormatterAsFunction(): void {
  const handler = new TestHandler("DEBUG", {
    formatter: (logRecord): string =>
      `fn formatter ${logRecord.levelName} ${logRecord.msg}`,
  });

  handler.handle(new LogRecord("Hello, world!", [], LogLevel.ERROR));

  assertEquals(handler.messages, ["fn formatter ERROR Hello, world!"]);
});

test({
  name: "FileHandler with mode 'w' will wipe clean existing log file",
  async fn() {
    const fileHandler = new FileHandler("WARNING", {
      filename: LOG_FILE,
      mode: "w",
    });

    await fileHandler.setup();
    fileHandler.handle(new LogRecord("Hello World", [], LogLevel.WARNING));
    await fileHandler.destroy();
    const firstFileSize = (await Deno.stat(LOG_FILE)).size;

    await fileHandler.setup();
    fileHandler.handle(new LogRecord("Hello World", [], LogLevel.WARNING));
    await fileHandler.destroy();
    const secondFileSize = (await Deno.stat(LOG_FILE)).size;

    assertEquals(secondFileSize, firstFileSize);
    Deno.removeSync(LOG_FILE);
  },
});

test({
  name: "FileHandler with mode 'x' will throw if log file already exists",
  async fn() {
    await assertThrowsAsync(
      async () => {
        Deno.writeFileSync(LOG_FILE, new TextEncoder().encode("hello world"));
        const fileHandler = new FileHandler("WARNING", {
          filename: LOG_FILE,
          mode: "x",
        });
        await fileHandler.setup();
      },
      Deno.errors.AlreadyExists,
      "ile exists"
    );
    Deno.removeSync(LOG_FILE);
  },
});

test({
  name:
    "RotatingFileHandler with mode 'w' will wipe clean existing log file and remove others",
  async fn() {
    Deno.writeFileSync(LOG_FILE, new TextEncoder().encode("hello world"));
    Deno.writeFileSync(
      LOG_FILE + ".1",
      new TextEncoder().encode("hello world")
    );
    Deno.writeFileSync(
      LOG_FILE + ".2",
      new TextEncoder().encode("hello world")
    );
    Deno.writeFileSync(
      LOG_FILE + ".3",
      new TextEncoder().encode("hello world")
    );

    const fileHandler = new RotatingFileHandler("WARNING", {
      filename: LOG_FILE,
      maxBytes: 50,
      maxBackupCount: 3,
      mode: "w",
    });
    await fileHandler.setup();
    await fileHandler.destroy();

    assertEquals((await Deno.stat(LOG_FILE)).size, 0);
    assert(!existsSync(LOG_FILE + ".1"));
    assert(!existsSync(LOG_FILE + ".2"));
    assert(!existsSync(LOG_FILE + ".3"));

    Deno.removeSync(LOG_FILE);
  },
});

test({
  name:
    "RotatingFileHandler with mode 'x' will throw if any log file already exists",
  async fn() {
    await assertThrowsAsync(
      async () => {
        Deno.writeFileSync(
          LOG_FILE + ".3",
          new TextEncoder().encode("hello world")
        );
        const fileHandler = new RotatingFileHandler("WARNING", {
          filename: LOG_FILE,
          maxBytes: 50,
          maxBackupCount: 3,
          mode: "x",
        });
        await fileHandler.setup();
      },
      Deno.errors.AlreadyExists,
      "Backup log file " + LOG_FILE + ".3 already exists"
    );
    Deno.removeSync(LOG_FILE + ".3");
    Deno.removeSync(LOG_FILE);
  },
});

test({
  name: "RotatingFileHandler with first rollover",
  async fn() {
    const fileHandler = new RotatingFileHandler("WARNING", {
      filename: LOG_FILE,
      maxBytes: 25,
      maxBackupCount: 3,
      mode: "w",
    });
    await fileHandler.setup();

    fileHandler.handle(new LogRecord("AAA", [], LogLevel.ERROR)); // 'ERROR AAA\n' = 10 bytes
    assertEquals((await Deno.stat(LOG_FILE)).size, 10);
    fileHandler.handle(new LogRecord("AAA", [], LogLevel.ERROR));
    assertEquals((await Deno.stat(LOG_FILE)).size, 20);
    fileHandler.handle(new LogRecord("AAA", [], LogLevel.ERROR));
    // Rollover occurred. Log file now has 1 record, rollover file has the original 2
    assertEquals((await Deno.stat(LOG_FILE)).size, 10);
    assertEquals((await Deno.stat(LOG_FILE + ".1")).size, 20);

    await fileHandler.destroy();

    Deno.removeSync(LOG_FILE);
    Deno.removeSync(LOG_FILE + ".1");
  },
});

test({
  name: "RotatingFileHandler with all backups rollover",
  async fn() {
    Deno.writeFileSync(LOG_FILE, new TextEncoder().encode("original log file"));
    Deno.writeFileSync(
      LOG_FILE + ".1",
      new TextEncoder().encode("original log.1 file")
    );
    Deno.writeFileSync(
      LOG_FILE + ".2",
      new TextEncoder().encode("original log.2 file")
    );
    Deno.writeFileSync(
      LOG_FILE + ".3",
      new TextEncoder().encode("original log.3 file")
    );

    const fileHandler = new RotatingFileHandler("WARNING", {
      filename: LOG_FILE,
      maxBytes: 2,
      maxBackupCount: 3,
      mode: "a",
    });
    await fileHandler.setup();
    fileHandler.handle(new LogRecord("AAA", [], LogLevel.ERROR)); // 'ERROR AAA\n' = 10 bytes
    await fileHandler.destroy();

    const decoder = new TextDecoder();
    assertEquals(decoder.decode(Deno.readFileSync(LOG_FILE)), "ERROR AAA\n");
    assertEquals(
      decoder.decode(Deno.readFileSync(LOG_FILE + ".1")),
      "original log file"
    );
    assertEquals(
      decoder.decode(Deno.readFileSync(LOG_FILE + ".2")),
      "original log.1 file"
    );
    assertEquals(
      decoder.decode(Deno.readFileSync(LOG_FILE + ".3")),
      "original log.2 file"
    );
    assert(!existsSync(LOG_FILE + ".4"));

    Deno.removeSync(LOG_FILE);
    Deno.removeSync(LOG_FILE + ".1");
    Deno.removeSync(LOG_FILE + ".2");
    Deno.removeSync(LOG_FILE + ".3");
  },
});

test({
  name: "RotatingFileHandler maxBytes cannot be less than 1",
  async fn() {
    await assertThrowsAsync(
      async () => {
        const fileHandler = new RotatingFileHandler("WARNING", {
          filename: LOG_FILE,
          maxBytes: 0,
          maxBackupCount: 3,
          mode: "w",
        });
        await fileHandler.setup();
      },
      Error,
      "maxBytes cannot be less than 1"
    );
  },
});

test({
  name: "RotatingFileHandler maxBackupCount cannot be less than 1",
  async fn() {
    await assertThrowsAsync(
      async () => {
        const fileHandler = new RotatingFileHandler("WARNING", {
          filename: LOG_FILE,
          maxBytes: 50,
          maxBackupCount: 0,
          mode: "w",
        });
        await fileHandler.setup();
      },
      Error,
      "maxBackupCount cannot be less than 1"
    );
  },
});
