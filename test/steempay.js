const assert = require('assert')
const request = require('request-promise-native')
const crypto = require('crypto')
const testdir = require('fs-jetpack').dir(__dirname)

const { Bot, Client} = require('../steempay.js')

const randString = () => crypto.randomBytes(32).toString('hex')

describe('Steempay', function(){
  this.timeout(10 * 60 * 1000)
  before(async () => {
    const keys = testdir.read('keys.json', 'json')
    if (!keys){
      throw new Error(`Must run 'npm run get_test_keys'`)
    }

    const user1_tokens = JSON.parse(
      await request(`https://steemconnect.com/api/oauth2/token?refresh_token=${keys.user_one.refresh_token}&grant_type=refresh_token&client_secret=${keys.app_secret}`) 
    )
    const user2_tokens = JSON.parse(
      await request(`https://steemconnect.com/api/oauth2/token?refresh_token=${keys.user_two.refresh_token}&grant_type=refresh_token&client_secret=${keys.app_secret}`)
    )

    this.bot = new Bot({
      username : user2_tokens.username,
      sc2 : {
        app : keys.app_name,
        secret : keys.app_secret,
        callbackURL : 'http://localhost:4000',
        accessToken : user2_tokens.access_token,
        scope : [
          'vote',
          'comment',
          'offline'
        ]
      },
      services : [{
        config : {
          permlink : 'test-service-permlink'
        }
      }]
    })

    this.client = new Client({
      username : user2_tokens.username,
      sc2 : {
        app : keys.app_name,
        callbackURL : 'http://localhost:4000',
        accessToken : user2_tokens.access_token,
        scope : [
          'vote',
          'comment',
          'offline'
        ]
      }
    })
  })
  
  it('initializes client', async () => {
    await this.client.init()
  })

  it('initializes bot', async () => {
    await this.bot.init()
  })

  it('starts bot', (done) => {
    this.bot.start()
    setTimeout(done,5000)
  })

  it('issues purchase', async () => {
    try {
      this.order = await this.client.placeOrder({
        seller : this.bot.username,
        service_permlink : this.bot.services[0].permlink,
      })
      console.log("PLACED ORDER", this.order)
    } catch (e){
      console.log(e)
    }
 
  })

  it('fulfills order', async () => {
    const delivery = await this.client.receiveDelivery({
      seller : this.bot.username,
      order : this.order
    })
    console.log("DELIVERY", delivery)
    assert(delivery.body === this.client.username)
  })


  after(async () => {
    console.log('stopping')
    await this.bot.stop()
    console.log("stopped")
  })

})