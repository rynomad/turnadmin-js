const { Bot } = require('./steempay_client.js')
const steemconnect = require('sc2-sdk')

class BrowserBot extends Client {
  constuctor(options) {
    super(options)
  }

  getTokenFromLocalStorage() {

    const access_token = localStorage.getItem('access_token')
    const username = localStorage.getItem('username')
    const expires_at = localStorage.getItem('expires_at') || 0

    if (expires_at < (Date.now() - 60 * 60 * 1000 * 24)) {
      return null
    }

    return {
      access_token,
      username,
      expires_at
    }

  }

  getTokenFromURL() {
    const searchparams = new URLSearchParams(document.location.search)
    const access_token = searchparams.get('access_token')
    const username = searchparams.get('username')
    const expires_at = (searchparams.get('expires_in') || 0) + Date.now()

    if (expires_at < (Date.now() - 60 * 60 * 1000 * 24)) {
      return null
    }

    localStorage.setItem('access_token', access_token)
    localStorage.setItem('username', username)
    localStorage.setItem('expires_at', expires_at)

    return {
      access_token,
      username,
      expires_at
    }
  }

  replaceAPI() {
    const options = { ...this._api.options, callbackURL: location.href },
    this._api = steemconnect.Initialize(options)
  }

  login() {
    const a = document.createElement('a')
    a.setAttribute('href', this._api.getLoginURL())
    document.body.appendChild(a)
    a.click()
  }

  initSteemConnect() {
    const creds = this.getTokenFromLocalStorage() || this.getTokenFromURL()
    if (creds) {
      const { access_token, username } = creds
      this.username
      this._api.setAccessToken(access_token)
    } else {
      this.login()
    }
  }

  async init() {
    this.initSteemConnect()
    await super.init()
  }
}

class Call {
  constructor({ iceServer, localVideo, remoteVideo }) {
    this.iceServer = iceServer,
    this.localVideo = document.getElementById(localVideo)
    this.remoteVideo = document.getElementById(remoteVideo)
  }

  start(isCaller) {

    let [protocol, hostname, port] = this.iceServer.urls.split(':')
    hostname = '//' + hostname
    protocol = 'wss'
    port = Number.parseInt(port) + 1
    const signaladdress = [protocol, hostname, port].join(':')


    this.start(true)
    var constraints = {
      video: true,
      audio: true,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints)

    this.localStream = stream;
    this.localVideo.srcObject = stream;

    this.serverConnection = new WebSocket(signaladdress);
    this.serverConnection.onmessage = (msg) => this.gotMessageFromServer(msg);

    this.peerConnection = new RTCPeerConnection({
      iceServers: [this.iceServer]
    });
    this.peerConnection.onicecandidate = (evt) => this.gotIceCandidate(evt);
    this.peerConnection.ontrack = (evt) => this.gotRemoteStream(evt);
    this.peerConnection.addStream(this.localStream);



    if (isCaller) {
      this.recorder = new CallRecorder(this.peerConnection)

      const offer = await this.peerConnection.createOffer()
      
      await this.peerConnection.setLocalDescription(offer)
      this.serverConnection.send(JSON.stringify({ 'sdp': this.peerConnection.localDescription, 'uuid': uuid }));
    }
  }

  async gotMessageFromServer(message) {

    var signal = JSON.parse(message.data);

    if (signal.sdp) {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp))
      // Only create answers in response to offers
      if (signal.sdp.type == 'offer') {
        const description = await peerConnection.createAnswer()

        await this.peerConnection.setLocalDescription(description)

        this.serverConnection.send(JSON.stringify({ 'sdp': this.peerConnection.localDescription }));
      }
    } else if (signal.ice) {
      const candidate = new RTCIceCandidate(signal.ice)
      this.peerConnection.addIceCandidate(candidate).catch(errorHandler);
    }
  }

  gotIceCandidate(event) {
    if (event.candidate != null) {
      this.serverConnection.send(JSON.stringify({ 'ice': event.candidate }));
    }
  }

  gotRemoteStream(event) {
    console.log('got remote stream');
    this.remoteVideo.srcObject = event.streams[0];
  }

}

class SturnClient {
  constructor({ localVideo, remoteVideo, ringer, steempay }) {
    this.localVideo = localVideo
    this.remoteVideo = remoteVideo
    this.bot = new BrowserBot({
      ...steempay,
      services: [
        {
          name: 'Sturn Call',
          permlink: 'steempay-service-call',
          provider: async (user, service) => {
            const accept = await ringer(user)
            if (accept){
              const {credential, service} = this.sturnCredentials.shift() || {}
              if (!credential) return
              this.call = new Call({ iceServer: credential, localVideo, remoteVideo })
              this.call.start()
              return service
            }
          }
        }
      ]
    })

    this.sturnCredentials = []
  }

  async init() {
    await this.bot.init()
    this.sturnServices = await this.bot.findServices('sturn')
  }

  async getCredential(){
    const service = this.sturnServices.pop()
    const credential = await this.bot.purchase(service)

    this.sturnCredentials.push({credential, service})
    this.sturnServices.unshift(service)
  }

  async start() {
    await this.bot.start()
  }

  async call(username) {
    const callservice = {
      username,
      service_permlink: 'steempay-service-call'
    }
    const sturn_service = await this.purchase(callservice)
    const iceServer = await this.purchase(sturn_service)

    this.call = new Call({
      iceServer,
      localVideo: this.localVideo,
      remoteVideo: this.remoteVideo
    })

    this.call.start(true)
  }

}


class CallRecorder extends EventEmitter {
  constructor(peerConnection){
    this.pc = peerConnection
    this.createDataChannels()
  }

  stopRecording(){
    console.log('got stop command')
    this.localRecorder.stop()
    this.dcs.signal.close()
  }

  startRecording(event, arg){
    console.log("START RECORDIGN")
    this.localRecorder = new MediaRecorder(appController.localStream_, {mimeType: 'video/webm;codecs=vp9'})
    this.localRecorder.ondataavailable = (event) => {
      console.log('got video data', event)
      const data = event.data
      const reader = new FileReader()
      reader.onload = () => {
        this.emit('local_chunk', {data : reader.result})
      }
      reader.readAsArrayBuffer(data)
    }

    this.dcs.video.onmessage = async ({data}) => {
      console.log('got remote video data', data)
      const blob = new Blob([data])
      const reader = new FileReader()
      reader.onload = () => {
        this.emit('remote_chunk', {data : reader.result})
      }
      reader.readAsArrayBuffer(blob)
    }

    this.dcs.video.onclose = async () => {
      console.log("remote video closed")
      this.emit('done')
    }

    const signal = new ArrayBuffer(5)

    this.dcs.signal.onclose = () => {}

    this.dcs.signal.send(signal)
    this.localRecorder.start(100)
  }

  createDataChannels(){
    this.dcs = {}
    this.pc.ondatachannel = function (event) {
      console.log("GOT CHANNEL", event.channel)
    } ;
    this.dcs.video = this.pc.createDataChannel('video', {negotiated : true, id : 0}) 
    this.dcs.video.onopen = () => {
      console.log("VIDEO DC CONNECTED", appController.localStream)
      //this.startRecording()
    }

    this.dcs.video.onclose = () => {
      console.log("VIDEO DC CLOSEDs")
    }

    this.dcs.signal = this.pc.createDataChannel('signal', {negotiated : true, id : 1})
    this.dcs.signal.onopen = () => {
      console.log("SIGNAL CHANNEL OPEN",this.dcs.signal)
    }

    this.dcs.signal.onclose = () => {
      console.log("SIGNAL DC CLOSED")
      this.localRecorder.stop()
    }

    this.dcs.signal.onerror = (err) => {
      console.log(err)
    }

    this.dcs.signal.onmessage = (event) =>{
      let recorderState;
      console.log("remote got signal")
      this.localRecorder = new MediaRecorder(appController.localStream_, {mimeType: 'video/webm;codecs=vp9'})
      this.localRecorder.ondataavailable = ({data, currentTarget : {state}}) => {
        const reader = new FileReader()
        reader.onload = () => {
          console.log('sending video data to host', reader.result.byteLength)
          let i = 0;
          while (i < reader.result.byteLength){
            this.dcs.video.send(reader.result.slice(i, i + 16000))
            i += 16000
          }
          recorderState = state
        }
        reader.readAsArrayBuffer(data)
      }

      this.localRecorder.onstop = async () => {
        while (this.dcs.video.bufferedAmount > 0 || recorderState !== 'inactive'){
          console.log(`flushing ${this.dcs.video.bufferedAmount} bytes, recorderState = ${recorderState}`)
          await wait(1000)
        }
        console.log("no more to flush, closing channel")
        this.dcs.video.close()
      }

      this.localRecorder.start(100)
    }
  }
}