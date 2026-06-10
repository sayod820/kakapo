'use client'

import { Suspense, type ReactNode } from 'react'

export default function AppNavigationBoundary({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return <Suspense fallback={fallback}>{children}</Suspense>
}
