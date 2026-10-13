import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import {installFeedback} from './feedback.js';
const cleanupFeedback=installFeedback();
if(import.meta.hot)import.meta.hot.dispose(cleanupFeedback);
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);

if(import.meta.env.PROD && 'serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register(import.meta.env.BASE_URL+'sw.js',{scope:import.meta.env.BASE_URL}).catch(()=>{}));}
