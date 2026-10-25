import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import net from "node:net";
import { emitKeypressEvents } from "node:readline";
import {
  lanTestRecoveryPaths,
  recoverLanTestAccount,
} from "../server/lanTestRecovery";

function hiddenPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    return Promise.reject(
      new Error(
        "Run this command in an interactive terminal; password arguments and pipes are not accepted"
      )
    );
  process.stdout.write(prompt);
  emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolvePassword, reject) => {
    let value = "";
    const cleanup = () => {
      process.stdin.off("keypress", keypress);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const keypress = (
      text: string,
      key: { name?: string; ctrl?: boolean; meta?: boolean }
    ) => {
      if (key.ctrl && (key.name === "c" || key.name === "d")) {
        cleanup();
        reject(new Error("Recovery cancelled; no password changed"));
      } else if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolvePassword(value);
      } else if (key.name === "backspace")
        value = Array.from(value).slice(0, -1).join("");
      else if (
        text &&
        !key.ctrl &&
        !key.meta &&
        !/[\x00-\x1f\x7f]/.test(text)
      ) {
        value += text;
        if (value.length > 256) {
          cleanup();
          reject(new Error("Password must not exceed 256 characters"));
        }
      }
    };
    process.stdin.on("keypress", keypress);
  });
}
async function requireStopped(port: number) {
  await new Promise<void>((accept, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1500);
    socket.once("connect", () => {
      socket.destroy();
      reject(
        new Error(
          "Stop the LAN test server with Ctrl+C before recovering its account"
        )
      );
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") accept();
      else
        reject(new Error("Cannot verify that the LAN test server is stopped"));
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("Cannot verify that the LAN test server is stopped"));
    });
  });
}
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help")
    console.log(
      "Usage: pnpm test:lan:recover <username>\nOnly .lan-test/store.sqlite is supported. Stop the test server first. Password is requested privately in the terminal, never as an argument."
    );
  else {
    if (args.length !== 1 || args[0].startsWith("--"))
      throw new Error(
        "Specify exactly one test username. Do not include passwords or database paths."
      );
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const paths = lanTestRecoveryPaths(root);
    await requireStopped(paths.port);
    const password = await hiddenPassword("New password (typing is hidden): ");
    const confirmation = await hiddenPassword(
      "Confirm new password (typing is hidden): "
    );
    if (password !== confirmation)
      throw new Error("Passwords do not match; nothing changed");
    const result = recoverLanTestAccount(root, args[0], password);
    console.log(
      "Test account unlocked and password updated. Other accounts and business records were not changed.\nUse the new password to log in; no additional first-login change is required.\nVerified backup: " +
        result.backupPath
    );
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "LAN test recovery failed"
  );
  process.exitCode = 1;
}
