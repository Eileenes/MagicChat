import { loadConfig } from "./config.js"
import { createDocumentServer } from "./server.js"

const config = loadConfig()
const server = createDocumentServer(config)
let shuttingDown = false

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.info(`received ${signal}, flushing collaborative documents`)
  try {
    await server.close()
    process.exitCode = 0
  } catch (error) {
    console.error("failed to stop document server", error)
    process.exitCode = 1
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown(signal))
}

process.on("unhandledRejection", (error) => {
  console.error("unhandled rejection", error)
})

await server.listen()
console.info(`document server listening on ${config.host}:${config.port}`)
