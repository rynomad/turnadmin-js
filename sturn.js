const {Bot} = require('./steempay.js')
const TurnAdmin = require('./turnadmin.js')
const jetpack = require('fs-jetpack')
const passgen = require('generate-password')

class STurn {
  constructor(username, realm, sc2_config){
    const sc2 = jetpack.read(sc2_config, 'json')

    this.turnadmin = new TurnAdmin()

    this.turnadmin.on('client', async ({type, data}) => {
      console.log("client event", type, data)
      if (type === 'connect'){
        console.log("got connection, deleting user")
        await this.turnadmin.deleteUser(data.connection)
      } 
    })

    this.bot = new Bot({
      username,
      sc2,
      services : [
        {
          provider : async (user) => {
            const password = passgen.generate({
              length : 32,
              numbers : true,
            })
            await this.turnadmin.addUser({user, password, realm})
            return JSON.stringify({
              urls : `stun:${realm}:443`,
              username : user,
              credential : password
            })
          },
          config : {
            permlink : 'steempay-service-sturn' 
          }
        }
      ]
    })

    this.bot.on('update', () => {
      console.log('got update')
      jetpack.write(sc2_config, this.bot._json.sc2)
    })
  }

  async init(){
    await this.turnadmin.init()
    await this.bot.init()
  }

  async start(){
    return this.bot.start()
  }

  async stop(){
    return this.bot.stop()
  }
}

if (require.main === module){
  async function run(){
    const server = new STurn(
      process.env.STURN_USER,
      process.env.STURN_REALM,
      process.env.STURN_CONFIG
    )

    await server.init()

    server.start().catch(err => {
      console.error('server error')
    }).then(() => {
      console.log('server stopped')
    })
  }

  run()
}