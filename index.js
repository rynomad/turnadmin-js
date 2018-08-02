const {execSync, spawn} = require('child_process')
const {EventEmitter} = require('events')    
const logs = require('fs-jetpack').cwd('/var/log/')
const ts = require('tail-stream')
const parseEvent = require('./events.js')


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

  static startTurn(){
    spawn('turnserver', ['-v'])
  }

  static getLogFile(){
    return logs.path(logs.find({matching : `turn_${this.getPID()}*.log`}).pop())
  }

  constructor(){
    super()

    this.new_clients = []

    while(!(this.pid = TurnAdmin.getPID())){
      console.warn("turnserver not running, attempting to start")
      TurnAdmin.startTurn()
    }

    const logfile = TurnAdmin.getLogFile()

    console.log("logfile : ", logfile)
    this.tail = ts.createReadStream(logfile, {
      beginAt : 'end',
      endOnError : true
    })

    this.tail.on('data', (data) => {
      console.log('LOGFILE',data.toString())
      const event = parseEvent(data.toString().trim())

      switch (event.type){
        case 'client':
          console.debug('CLIENT EVENT', event)
          this.new_clients.push(event.client)
        break
        case 'allocate':
          console.debug('ALLOCATE EVENT', event)
        break
        case 'usage':
          console.debug('USAGE EVENT', event)
        break
        case 'disconnect':
          console.debug('DISCONNECT EVENT', event)
          break
        default:
        console.info("dropping non-event", event)
      }
    })

    this.on('_log_line    ', (line) => {

    })
  }

}

module.exports = TurnAdmin