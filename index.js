const {execSync, spawn} = require('child_process')
const {EventEmitter} = require('events')    
const logs = require('fs-jetpack').cwd('/var/log/')
const ts = require('tail-stream')


function debracket(string){
  return string.match(/<\S*>/g).map(str => str.substr(1, str.length - 2))
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
  
  static parseLogEvent(buffer){
    const string = buffer.toString().trim()
    let event_match;
    let event = {}
    
    if (event_match = string.match(/New UDP endpoint.*remote addr.*/)){
      event_match = event_match[0]
      const [realm] = debracket(string)
  
      event = {
        type : 'client',
        client : {
          realm,
          ip : event_match.split(' ').pop().split(':')[0]
        }
      }

    } else if (event_match = string.match(/Local relay addr.*\n.*\n.*ALLOCATE processed, success/)){
      event_match = event_match[0]
      const [realm, user] = debracket(event_match)

      event = {
        type : 'allocate',
        allocate : {
          user,
          realm
        }
      } 

    } else if (event_match = string.match(/usage: realm.* username=.* sb=.*/)){
      event_match = event_match[0]
      const [realm, user] = debracket(event_match)

      const rp = Number.parseInt(event_match.match(/rp=[0-9]*/)[0].split('=')[1])
      const rb = Number.parseInt(event_match.match(/rb=[0-9]*/)[0].split('=')[1])
      const sp = Number.parseInt(event_match.match(/sp=[0-9]*/)[0].split('=')[1])
      const sb = Number.parseInt(event_match.match(/sb=[0-9]*/)[0].split('=')[1])

      event = {
        type : 'usage',
        allocate : {
          realm,
          user,
          rp, rb, sp, sb
        }
      }
      
    } else if (event_match = string.match(/closed.*user.*realm.*origin.*local.*remote.*/)){
      event_match = event_match[0]
      const [user, realm, origin] = debracket(event_match)  

      let ip = event_match.match(/remote \S*:/)[0]
      ip = ip.split(' ').pop()
      ip = ip.substr(0, ip.length - 1)

      let reason = event_match.match(/reason:.*/)[0].split(' ')
      reason.shift()
      reason = reason.join(' ')

      event = {
        type : 'disconnect',
        disconnect : {
          user,
          realm,
          origin,
          ip,
          reason
        }
      }

    }

    return event
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
      const event = TurnAdmin.parseLogEvent(data)

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
        console.info("dropping non-event")
      }
    })

    this.on('_log_line    ', (line) => {

    })
  }

}

module.exports = TurnAdmin