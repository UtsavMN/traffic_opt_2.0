import React from 'react';
import { useSimStore } from '../store/simStore.js';

export default function LoadingScreen() {
  const loading = useSimStore(s => s.loading);

  if (!loading) return null;

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      background: '#0A0C0F', zIndex: 9999,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{
        fontSize: 32, fontWeight: 700, color: '#FFFFFF', marginBottom: 20,
        fontFamily: '"DM Mono", monospace'
      }}>
        ZENITH
      </div>
      <div style={{ color: '#00E87A', marginBottom: 20 }}>
        {loading}
      </div>
      <div style={{
        width: 300, height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden'
      }}>
        <div style={{
          width: '50%', height: '100%', background: '#00E87A',
          animation: 'load-anim 1s infinite ease-in-out alternate'
        }} />
      </div>
      <style>{`
        @keyframes load-anim {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  );
}
