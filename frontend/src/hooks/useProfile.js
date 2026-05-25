import { useState, useEffect } from 'react';

const STORAGE_KEY = 'cronstream_profile';

export function useProfile(address) {
  const key = address ? `${STORAGE_KEY}_${address.toLowerCase()}` : null;

  const [profile, setProfileState] = useState(() => {
    if (!key) return null;
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (!key) return;
    try {
      const stored = localStorage.getItem(key);
      setProfileState(stored ? JSON.parse(stored) : null);
    } catch {
      setProfileState(null);
    }
  }, [key]);

  function saveProfile(data) {
    if (!key) return;
    const updated = { ...data, address, updatedAt: Date.now() };
    localStorage.setItem(key, JSON.stringify(updated));
    setProfileState(updated);
  }

  return { profile, saveProfile, hasProfile: !!profile };
}
