const {execSync, exec} = require('child_process')
const {EventEmitter} = require('events')    
const logs = require('fs-jetpack').cwd('/var/log/')
const ts = require('tail-stream')
const {parseLogEvent, consumeLogEvent} = require('./events.js')


function debracket(string){
  return string.match(/<\S*>/g).map(str => str.substr(1, str.length - 2))
}

function getMatch(string, regex){
  let match = string.match(regex)
  if (!match) return null
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
  }

  async exec(argstr){
    return new Promise((resolve, reject) => {
      exec(`turnadmin ${argstr}`, (err, stdout, stderr) => {
        if (err){
          reject(err)
        } else {
          resolve({stdout, stderr})
        }
      })
    })
  }

  async addUser({user, password, realm}){
    const {stdout, stderr} = await this.exec(`-a -u ${user} -p ${password} -r ${realm}`)
    console.log('out',stdout)
    console.error('err',stderr)
  }

  async listUsers(){
    const {stdout, stderr} = await this.exec(`-l`)
    console.log('out',stdout)
    console.error('err',stderr)
  }

  async deleteUser({user, realm}){
    const {stdout, stderr} = await this.exec(`-d -u ${user} -r ${realm}`)
    console.log('out',stdout)
    console.error('err',stderr)
  }

}

module.exports = TurnAdmin