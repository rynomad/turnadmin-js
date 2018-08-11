
const fs = require('fs');
const https = require('https');
const WebSocket = require('ws');
const Server = WebSocket.Server

class Signaler{
  constructor({
    port,
    keyfile,
    certfile
  }) {
    this.port = port
    this.server = https.createServer({
      cert: fs.readFileSync(certfile),
      key: fs.readFileSync(keyfile)
    }, () => {

    })
    this.wss = new Server({ server : this.server })

    this.connections = new Map()
    this.credentials = new Map()
    this.fifo = []
  }

  init() {
    this.wss.on('connection', (ws) => {
      console.log("connection")
      const consumeLogin = (message) => {
        console.log("login", message)
        const { username, credential } = JSON.parse(message)
        if (this.credentials.has(username) && (this.credentials.get(username) === credential)) {
          console.log("accept", username)
          this.acceptConnection(username, ws)

          ws.on('close', () => {
            console.log("closed")
            this.connections.delete(username)
          })
        } else {
          console.log("reject")
          ws.close()
        }
      }

      ws.once('message', consumeLogin)
    })


    this.server.listen(this.port)
  }


  async waitStarted(ms) {
    return new Promise((resolve) => {
      setTimeout(() => resolve(this.started), ms)
    })
  }

  async waitStopping(ms) {
    return new Promise((resolve) => {
      setTimeout(() => resolve(this.stopping), ms)
    })
  }

  async start() {
    this.started = true

    do {
      const pending = []
      let next

      while (next = this.fifo.shift()) {
        if (this.connections.has(next.to)) {
          const ws = this.connections.get(next.to)
          ws.send(JSON.stringify(next.data))
        } else {
          pending.push(next)
        }
      }

      this.fifo = pending
    } while (await this.waitStarted(500))

    this.stopping = false
  }

  async stop() {
    this.stopping = true
    this.started = false
    while (await this.waitStopping(500)) { }
  }

  acceptConnection(username, ws) {
    this.credentials.delete(username)
    this.connections.set(username, ws)
    ws.on('message', (message) => {
      console.log("message", message)
      this.fifo.push(JSON.parse(message))
    })
  }

  async addUser(username, credential) {
    this.credentials.set(username, credential)
  }

  async deleteUser() {
    this.credentials.delete(username, credential)
  }
}

module.exports = Signaler

if (require.main === module) {
  function run() {
    const signaler = new Signaler({
      port: 8000,
      keyfile: 'key.pem',
      certfile: 'cert.pem'
    })

    signaler.init()

    signaler.addUser('user1', 'pass')
    signaler.addUser('user2', 'pass')

    signaler.start()


  }

  run()
}