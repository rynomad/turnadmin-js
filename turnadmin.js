const {execSync, exec} = require('child_process')
const {EventEmitter} = require('events')    
const logs = require('fs-jetpack').cwd('/var/log/')
const ts = require('tail-stream')
const {parseLogEvent, consumeLogEvent} = require('./events.js')

const wait = (ms) => new Promise((resolve, reject) => setTimeout(() => resolve(true), ms))

function debracket(string){
  return string.match(/<\S*>/g).map(str => str.substr(1, str.length - 2))
}

function getMatch(string, regex){
  let match = string.match(regex)
  if (!match) return nulls
  match = match[0]
  return match
}

class TurnAdmin extends EventEmitter{
  static getPID(){
    try {
      return Number.parseInt(execSync('pgrep turnserver').toString().trim()) - 1
    } catch (e) {
      return 0
    }
  }

  static getLogFile(){
    return logs.path(logs.find({matching : `turn_${this.getPID()}*.log`}).pop())
  }

  constructor(){
    super()

    this.connections = new Map()

    this.boots = new Map()
    this.fifo = []
  }

  init(){

    if (!(this.pid = TurnAdmin.getPID())){
      throw new Error('Turn server not found')
    }

    const logfile = TurnAdmin.getLogFile()

    console.log("logfile : ", logfile)
    this.tail = ts.createReadStream(logfile, {
      beginAt : 'end',
      endOnError : true
    })

    this.tail.on('data', (data) => {
      const raw = data.toString().trim()
      const event = parseLogEvent(raw)
      if (event) {
        this.emit('log', {raw, ...event})
      }
    })

    this.on('log', (event) => {
      console.log("CONSUME LOG EVENT", event)
      event = consumeLogEvent(this, event)
      if (event){
        this.emit('client', event)
      } else {
        console.debug("IGNORE")
      }
    })

    setInterval(() => {
      for (let [time, cmd] of this.boots){
        if (time < Date.now()){
          console.log("clearing boot", cmd)
          exec(cmd, (err, stdout, stderr) => {
            if (err) {
              console.log("error clearing boot", cmd)
              console.log(err)
            }
            this.boots.delete(time)
          })
        }
      }
    },10000)

    process.on('exit', () => {
      console.log('clearing remaining boots')
      for (let [_, cmd] of this.boots){
        execSync(cmd)
      }
      console.log('cleared')
    })
  }

  async __exec(execstr){
    return new Promise((resolve, reject) => {
      exec(execstr, (err, stdout, stderr) => {
        if (err){
          reject(err)
        } else {
          resolve({stdout, stderr})
        }
      })
    })
  }

  async _exec(execstr){
    if (this._execing) return
    this._execing = true
    while (this.fifo.length){
      const job = this.fifo.shift()
      try {
        job.promise.resolve(await this.__exec(job.execstr))
      } catch (e){
        job.promise.reject(e)
      }
      await wait(1000)
    } 
    this._execing = false
  }

  async exec(argstr){
    const execstr = `turnadmin ${argstr}`
    return new Promise((resolve, reject) => {
      console.log("exec into fifo", execstr)
      this.fifo.push({
        promise : {
          resolve,
          reject
        },
        execstr 
      })
      this._exec()
    })
  }

  async addUser({user, password, realm}){
    const {stdout, stderr} = await this.exec(`-a -u ${user} -p ${password} -r ${realm}`)
    console.log('out',stdout)
    console.error('err',stderr)
  }

  async listUsers(){
    const {stdout, stderr} = await this.exec(`-l`)
    return stdout.trim().split('\n').map(str => {
      const [user, realm] = str.substr(0, str.length - 1).split('[')
      return {user, realm}
    })
  }

  async deleteUser({user, realm}){
    const {stdout, stderr} = await this.exec(`-d -u ${user} -r ${realm}`)
    console.log('out',stdout)
    console.error('err',stderr)
  }

  async bootConnection({ip}){
    return new Promise((resolve, reject) => {
      exec(`iptables -A INPUT -p udp -s ${ip} -j DROP`, (err, stdout, stderr) => {
        if (err) return reject(err)
        console.log('set iptables tule')
        this.boots.set(Date.now() + 120000, `iptables -D INPUT -p udp -s ${ip} -j DROP`)
        resolve()
      })
    })
  }

}

module.exports = TurnAdmin