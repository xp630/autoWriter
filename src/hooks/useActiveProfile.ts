// useActiveProfile / useProfiles — 订阅身份存储变化
import { useSyncExternalStore, useCallback } from 'react';
import {
  subscribeProfiles, getActiveProfile, listProfiles,
  type CreatorProfile,
} from '../utils/storage';

// getSnapshot 必须返回稳定引用；用序列化值做变化检测缓存
let cachedProfile: CreatorProfile | null = null;
let cachedProfileKey = '';
function profileSnapshot(): CreatorProfile {
  const p = getActiveProfile();
  const key = JSON.stringify(p);
  if (key !== cachedProfileKey) { cachedProfileKey = key; cachedProfile = p; }
  return cachedProfile!;
}

let cachedList: CreatorProfile[] = [];
let cachedListKey = '';
function listSnapshot(): CreatorProfile[] {
  const l = listProfiles();
  const key = JSON.stringify(l);
  if (key !== cachedListKey) { cachedListKey = key; cachedList = l; }
  return cachedList;
}

export function useActiveProfile(): CreatorProfile {
  return useSyncExternalStore(subscribeProfiles, profileSnapshot, profileSnapshot);
}

export function useProfiles(): CreatorProfile[] {
  return useSyncExternalStore(subscribeProfiles, listSnapshot, listSnapshot);
}

/** 便捷 hook：拿当前身份 + 常用派生 */
export function useIdentity() {
  const profile = useActiveProfile();
  const refresh = useCallback(() => { /* 订阅自动更新，这里仅占位 */ }, []);
  return { profile, refresh };
}
