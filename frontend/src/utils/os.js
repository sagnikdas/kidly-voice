import { createContext, useContext } from 'react'

export const OSContext = createContext('web')
export const useOS = () => useContext(OSContext)

export function detectOS() {
  if (typeof navigator === 'undefined') return 'web'
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  // iPadOS 13+ reports as Mac but has touch points
  if (/Mac/i.test(navigator.platform || '') && navigator.maxTouchPoints > 1) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'web'
}
