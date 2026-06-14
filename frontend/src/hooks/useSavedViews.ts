import { useState } from 'react';
import { v4 } from '../utils/uuid';

export interface SavedView<T> {
  id: string;
  name: string;
  filters: T;
}

function load<T>(storageKey: string): SavedView<T>[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

function save<T>(storageKey: string, views: SavedView<T>[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(views));
  } catch {
    // ignore
  }
}

export function useSavedViews<T>(storageKey: string) {
  const [views, setViews] = useState<SavedView<T>[]>(() => load<T>(storageKey));

  const saveView = (name: string, filters: T) => {
    const next = [...views, { id: v4(), name, filters }];
    setViews(next);
    save(storageKey, next);
  };

  const deleteView = (id: string) => {
    const next = views.filter(v => v.id !== id);
    setViews(next);
    save(storageKey, next);
  };

  return { views, saveView, deleteView };
}
