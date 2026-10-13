import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
const base=process.env.APP_BASE_PATH || '/';
const prefix=base.replace(/\/$/,'');
export default defineConfig({base,plugins:[react()],server:{proxy:{[prefix+'/api']:'http://127.0.0.1:4177',[prefix+'/_AMapService']:'http://127.0.0.1:4177'}},build:{outDir:'dist'}});
