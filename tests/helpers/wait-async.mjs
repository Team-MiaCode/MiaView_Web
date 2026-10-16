import {setTimeout as delay} from "node:timers/promises";

export async function waitForAsync(page,predicate,arg,{timeout=30000,polling=250}={}) {
  let stopped=false,timer;
  const poll=async()=>{
    while(!stopped) {
      const value=await page.evaluate(predicate,arg);
      if(value)return value;
      await delay(polling);
    }
  };
  const expired=new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error(`Async browser condition timed out: ${predicate.toString()}`)),timeout);
  });
  try{return await Promise.race([poll(),expired]);}
  finally{stopped=true;clearTimeout(timer);}
}
