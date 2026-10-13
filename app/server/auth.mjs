import { createHash,createHmac } from 'node:crypto';
import nodemailer from 'nodemailer';
export const hash=value=>createHash('sha256').update(value).digest('hex');
const hmac=(key,value,encoding)=>createHmac('sha256',key).update(value).digest(encoding);
export function channels(c){return {email:Boolean(c.smtpHost&&c.smtpFrom),phone:Boolean(c.smsSecretId&&c.smsSecretKey&&c.smsAppId&&c.smsSign&&c.smsTemplateId)};}
export async function deliverCode(config,identifier,code){
 if(identifier.includes('@')){
 const transporter=nodemailer.createTransport({host:config.smtpHost,port:config.smtpPort,secure:config.smtpPort===465,auth:config.smtpUser?{user:config.smtpUser,pass:config.smtpPass}:undefined});
 await transporter.sendMail({from:config.smtpFrom,to:identifier,subject:'旅程登录验证码',text:`你的登录验证码是 ${code}，10分钟内有效。`}); return;
 }
 const service='sms',host='sms.tencentcloudapi.com',timestamp=Math.floor(Date.now()/1000),date=new Date(timestamp*1000).toISOString().slice(0,10);
 const payload=JSON.stringify({PhoneNumberSet:[identifier],SmsSdkAppId:config.smsAppId,SignName:config.smsSign,TemplateId:config.smsTemplateId,TemplateParamSet:[code]});
 const canonical=`POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:${host}\n\ncontent-type;host\n${hash(payload)}`;
 const scope=`${date}/${service}/tc3_request`,signString=`TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${hash(canonical)}`;
 const signing=hmac(hmac(hmac(`TC3${config.smsSecretKey}`,date),service),'tc3_request');
 const signature=hmac(signing,signString,'hex');
 const response=await fetch(`https://${host}`,{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8','X-TC-Action':'SendSms','X-TC-Version':'2021-01-11','X-TC-Region':config.smsRegion,'X-TC-Timestamp':String(timestamp),Authorization:`TC3-HMAC-SHA256 Credential=${config.smsSecretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`},body:payload,signal:AbortSignal.timeout(15000)});
 const data=await response.json(); if(!response.ok||data.Response?.Error||data.Response?.SendStatusSet?.[0]?.Code!=='Ok') throw new Error('SMS delivery failed');
}
