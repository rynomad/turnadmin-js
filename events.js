

function debracket(string){
  return string.match(/<\S*>/g).map(str => str.substr(1, str.length - 2))
}

function getMatch(string, regex){
  let match = string.match(regex)
  if (!match) return null
  match = match[0]
  return match
}

const _parseLogEvent = {
  client(string){
    const event_match = getMatch(string, /New UDP endpoint.*remote addr.*\n.*401/)
    if (!event_match) return null
    
    const [realm] = debracket(string)
  
    return {
      type : 'client',
      data : {
        realm,
        ip : event_match.match(/[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/)[0]
      }
    }
  },
  allocate(string){
    const event_match = getMatch(string, /Local relay addr.*\n.*\n.*ALLOCATE processed, success/)
    if (!event_match) return null

    const [realm, user] = debracket(event_match)
  
    return {
      type : 'allocate',
      data : {
        user,
        realm
      }
    }
  },
  usage(string){
    const event_match = getMatch(string, /usage: realm.* username=.* sb=.*/)
    if (!event_match) return null

    const [realm, user] = debracket(event_match)
  
    const rp = Number.parseInt(event_match.match(/rp=[0-9]*/)[0].split('=')[1])
    const rb = Number.parseInt(event_match.match(/rb=[0-9]*/)[0].split('=')[1])
    const sp = Number.parseInt(event_match.match(/sp=[0-9]*/)[0].split('=')[1])
    const sb = Number.parseInt(event_match.match(/sb=[0-9]*/)[0].split('=')[1])
  
    return {
      type : 'usage',
      data : {
        realm,
        user,
        rp, rb, sp, sb
      }
    }
  },
  disconnect(string){
    const event_match = getMatch(string,/closed.*user.*realm.*origin.*local.*remote.*/)
    if (!event_match) return null

    const [user, realm, origin] = debracket(event_match)  
  
    let ip = event_match.match(/remote \S*:/)[0]
    ip = ip.split(' ').pop()
    ip = ip.substr(0, ip.length - 1)
  
    let reason = event_match.match(/reason:.*/)[0].split(' ')
    reason.shift()
    reason = reason.join(' ')
  
    return {
      type : 'disconnect',
      data : {
        user,
        realm,
        origin,
        ip,
        reason
      }
    }
  }
}

const parseLogEvent = (string) => Object.keys(_parseLogEvent).reduce((evt, type) => evt || _parseLogEvent[type](string), null)

const _consumeLogEvent = {
  pending_clients : new Map(),
  dead_clients : new Map(),
  client(_, {ip, realm}){
    _consumeLogEvent.pending_clients.set(realm, ip)
  },
  allocate(admin, {user, realm}){
    const ip = _consumeLogEvent.pending_clients.get(realm)
    if (!ip) return null
    _consumeLogEvent.pending_clients.delete(realm)

    const connection = {user, realm, ip}
    admin.connections.set(`${user}:${realm}`, connection)
    
    return {
      type : 'connect',
      data : {
        connection
      }
    }
  },
  usage(admin, {user, realm, ...usage}){
    const connection = admin.connections.get(`${user}:${realm}`) || this.dead_clients.get(`${user}:${realm}`)
    if (!admin.connections.has(`${user}:${realm}`)) {
      console.log("reviving dead connection")
      this.dead_clients.delete(`${user}:${realm}`)
      admin.connections.set(`${user}:${realm}`,connection)
    }

    return {
      type : 'usage',
      data : {
        connection,
        usage
      }
    }
  },
  disconnect(admin, {user, realm, ip, reason}){
    const connection = admin.connections.get(`${user}:${realm}`)
    if (!connection) return null
    admin.connections.delete(`${user}:${realm}`)
    this.dead_clients.set(`${user}:${realm}`, connection)

    return {
      type : 'disconnect',
      data : {
        connection,
        reason
      }
    }
  }
}

const consumeLogEvent = (admin, {type, data}) => {
  if (!_consumeLogEvent[type]){
    throw new Error(`unknown log event '${type}': ${data}`)
  }

  return _consumeLogEvent[type](admin, data)
}

module.exports = {
  parseLogEvent,
  consumeLogEvent
}