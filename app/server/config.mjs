import { existsSync,readFileSync } from 'node:fs';
export function loadConfig(overrides={}) {
 const amapConfigFile=process.env.AMAP_CONFIG_FILE||'.local/amap.json';
 let amap={}; if(existsSync(amapConfigFile)) amap=JSON.parse(readFileSync(amapConfigFile,'utf8'));
 const basePath=process.env.BASE_PATH||'/';
 return {basePath:basePath==='/'?'/':`/${basePath.replace(/^\/+|\/+$/g,'')}/`,trustProxy:process.env.TRUST_PROXY==='loopback'?'loopback':false,host:process.env.HOST||'127.0.0.1',port:Number(process.env.PORT||4177),securityPath:process.env.SECURITY_DATABASE_PATH,databasePath:process.env.DATABASE_PATH||'data/journey.sqlite',appOrigin:process.env.APP_ORIGIN||'http://127.0.0.1:4177',secureCookies:process.env.COOKIE_SECURE==='true',amapKey:process.env.AMAP_KEY||amap.key||'',amapSecurityJsCode:process.env.AMAP_SECURITY_JS_CODE||amap.securityJsCode||'',smtpHost:process.env.SMTP_HOST,smtpPort:Number(process.env.SMTP_PORT||587),smtpUser:process.env.SMTP_USER,smtpPass:process.env.SMTP_PASS,smtpFrom:process.env.SMTP_FROM,smsSecretId:process.env.TENCENT_SECRET_ID,smsSecretKey:process.env.TENCENT_SECRET_KEY,smsAppId:process.env.TENCENT_SMS_APP_ID,smsSign:process.env.TENCENT_SMS_SIGN,smsTemplateId:process.env.TENCENT_SMS_TEMPLATE_ID,smsRegion:process.env.TENCENT_SMS_REGION||'ap-guangzhou',...overrides};
}
