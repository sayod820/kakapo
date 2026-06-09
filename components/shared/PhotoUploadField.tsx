'use client';
import { useState } from 'react';

const MAX_BYTES = 5 * 1024 * 1024;

interface Props {
  value: string;
  onChange: (photo: string) => void;
  label?: string;
  height?: number;
}

export default function PhotoUploadField({ value, onChange, label = '📷 Фото товара', height = 140 }: Props) {
  const [err, setErr] = useState('');

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setErr('Файл слишком большой (макс. 5 МБ)');
      return;
    }
    setErr('');
    const reader = new FileReader();
    reader.onload = (ev) => onChange(ev.target?.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div>
      <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 7, fontWeight: 700 }}>{label}</div>
      {value ? (
        <div style={{ position: 'relative', width: '100%', height, borderRadius: 14, overflow: 'hidden', border: '1px solid #162B1A' }}>
          <img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top,rgba(0,0,0,.45) 0%,transparent 45%)' }} />
          <button
            type="button"
            onClick={() => onChange('')}
            style={{
              position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: '50%',
              background: 'rgba(0,0,0,.75)', border: '1px solid rgba(255,255,255,.2)', color: 'white',
              fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ✕
          </button>
          <div style={{ position: 'absolute', bottom: 10, left: 12, fontSize: 11, color: 'rgba(255,255,255,.85)', fontWeight: 700 }}>
            ✓ Фото добавлено
          </div>
        </div>
      ) : (
        <label
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
            width: '100%', height, borderRadius: 14, border: '2px dashed #1D3822', background: '#0C1C0F', cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 28 }}>📷</span>
          <span style={{ fontSize: 12, color: '#8FB897', fontWeight: 700 }}>Нажмите чтобы добавить фото</span>
          <span style={{ fontSize: 10, color: '#3D6645' }}>JPG, PNG, WebP · до 5 МБ</span>
          <input type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
        </label>
      )}
      {err && <div style={{ marginTop: 5, fontSize: 11, color: '#FF4545' }}>⚠️ {err}</div>}
    </div>
  );
}
