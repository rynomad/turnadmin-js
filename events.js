

function debracket(string){
  return string.match(/<\S*>/g).map(str => str.substr(1, str.length - 2))
}

function getMatch(string, regex){
  let match = string.match(regex)
  if (!match) return null
  match = match[0]
  return match
}

const events = {
  client(string){
    const event_match = getMatch(string, /New UDP endpoint.*remote addr.*/)
    if (!event_match) return null
    
    const [realm] = debracket(string)
  
    return {
      type : 'client',
      data : {
        realm,
        ip : event_match.split(' ').pop().split(':')[0]
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

module.exports = (string) => Object.keys(events).reduce((evt, type) => evt || events[type](string), null) || {}