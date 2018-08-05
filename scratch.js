const wait = (ms) => new Promise((resolve,reject) => setTimeout(() => resolve(true), ms))

const rand = async () => {
  await wait(100)
  return Date.now()
} 

async function loop(){
  while(await wait(5000)){
    console.log(await rand())
  }
}

console.log("start")
loop()
console.log("deferr")