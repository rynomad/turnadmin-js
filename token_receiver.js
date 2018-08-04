const https = require('https')
const url = require('url')
const {EventEmitter} = require('events')
const fs = require('fs')
const request = require('request')

class TokenManager extends EventEmitter{
  constructor({username, code, secretpath, certpath, keypath}){
    super()
    this.username = username
    this.code = code
    this.secret = fs.readFileSync(secretpath).toString().trim()
    this.cert = fs.readFileSync(certpath)
    this.key = fs.readFileSync(keypath)

    if (this.code){
      this.requestToken()
    } else {
      this.listenForCode()
    }
  }

  requestToken(){
    console.log("requesting token ", this.code, this.secret)
    request.get(`https://steemconnect.com/api/oauth2/token?code=${this.code}&client_secret=${this.secret}`, (err,res, body) => {
      console.log("GOT RES", err, body)
    })
  }

  listenForCode(){
    this.server = https.createServer({
      cert : this.cert,
      key : this.key
    },(request, response) => {
      const {query : {code}} = url.parse(request.url, true)
      console.log('got query', code)
      if (code) {
        this.requestToken(code)
        response.statusCode = 200
        response.end()
      } else {
        response.statusCode = 500
        response.statusMessage = "Bad Request"
        response.end()
      }
    })

    this.server.listen(4443)
  }
}

module.exports = TokenManager
