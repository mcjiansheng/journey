import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
const base=process.env.APP_BASE_PATH || '/';
const prefix=base.replace(/\/$/,'');
export default defineConfig({base,plugins:[react()],server:{proxy:{[prefix+'/api']:{target:'http://127.0.0.1:4177',changeOrigin:true,headers:{origin:'http://127.0.0.1:4177'}},[prefix+'/_AMapService']:{target:'http://127.0.0.1:4177',changeOrigin:true}}},build:{outDir:'dist'}});
