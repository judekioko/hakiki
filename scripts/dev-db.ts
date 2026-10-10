import path from "node:path";
import fs from "node:fs";
import net from "node:net";
import EmbeddedPostgres from "embedded-postgres";

const databaseDir = path.join(__dirname, "..", ".pgdata");
const port = 5433;
const user = "postgres";
const password = "VNOzMI_8dyHBqAbT";

const pg = new EmbeddedPostgres({
  databaseDir,
  port,
  user,
  password,
  persistent: true,
  // Only used when the data directory is first created: names and notes in any script (Amharic, Arabic, ...) must fit.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

function isPortOpen(portToCheck: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: portToCheck, host: "127.0.0.1" });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function main() {
  if (await isPortOpen(port)) {
    console.log(`Postgres is already running on port ${port} — nothing to start.`);
    return;
  }

  const alreadyInitialised = fs.existsSync(path.join(databaseDir, "PG_VERSION"));
  if (!alreadyInitialised) {
    console.log("Initialising Postgres data directory...");
    await pg.initialise();
  }

  console.log("Starting Postgres...");
  await pg.start();

  try {
    await pg.createDatabase("hakiki");
    console.log('Created database "hakiki"');
  } catch {
    console.log('Database "hakiki" already exists');
  }

  console.log(`Postgres is ready on postgresql://${user}:${password}@localhost:${port}/hakiki`);
  console.log("Press Ctrl+C to stop.");

  const shutdown = async () => {
    console.log("Stopping Postgres...");
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
