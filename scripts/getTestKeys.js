const http = require('http')
const url = require("url")
const steemconnect = require('sc2-sdk')
const steem = require('steem')
const testdir = require('fs-jetpack').dir('test')

console.log("TESTDIR", testdir.cwd())
const request = require('request-promise-native')
const template = {
  "app_secret" : process.env.STEEM_APP_SECRET,
  "app_name" : process.env.STEEM_APP_NAME,
}

if (!(template.app_secret && template.app_name)){
  throw new Error('must set process.env.STEEM_APP_SECRET && process.env.STEEM_APP_NAME')
}


const api = steemconnect.Initialize({
  "app": template.app_name,
  "callbackURL": "http://localhost:4000",
  "scope": [
    "vote",
    "offline",
    "comment",
    "custom_json",
    "delete_comment"
  ]
})

const login_url = `${api.getLoginURL()}&response_type=code`

const server = http.createServer(async (req, res) => {
  console.log(req.url)
  const {query : {code}} = url.parse(req.url, true)

  const token_url = `https://steemconnect.com/api/oauth2/token?code=${code}&client_secret=${template.app_secret}`
  if (!template.user_one){
    template.user_one = JSON.parse(await request.get(token_url))
    res.writeHead(302, {
      Location : login_url
    })
  } else if (!template.user_two) {
    template.user_two = JSON.parse(await request.get(token_url))
    testdir.write('keys.json',template)
    res.write('SUCCESS')
    setTimeout(() => {
      process.exit(0)
    }, 5000)
  }

  res.end()

  console.log(template)
})


server.listen(4000)


console.log(`visit ${login_url} and log in with your two test users`)


