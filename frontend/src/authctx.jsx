import React, { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api } from './api'

const AuthCtx = React.createContext(null)

export function AuthProvider({ children }) {
  const [actor, setActor] = useState(undefined)   // undefined = still checking
  // Every deliberate sign-in/out bumps this. The startup probe below discards
  // its own result if a login landed while it was in flight — otherwise a slow
  // /auth/me can overwrite a fresh magic-link session with null.
  const gen = useRef(0)

  const publish = useCallback(next => { gen.current += 1; setActor(next) }, [])

  const refresh = useCallback(async () => {
    const mine = gen.current
    try {
      const r = await api.me()
      if (gen.current === mine) setActor(r.actor)
    } catch {
      if (gen.current === mine) setActor(null)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return (
    <AuthCtx.Provider value={{ actor, setActor: publish, refresh }}>
      {children}
    </AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)
