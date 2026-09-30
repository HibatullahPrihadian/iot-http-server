import { createContext, useCallback, useContext, useState } from 'react'

const ToastContext = createContext(null)

let nextId = 1

// Toast kecil pengganti Notyf (hindari lib tambahan).
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const remove = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (type, message) => {
      const id = nextId++
      setToasts((prev) => [...prev, { id, type, message }])
      setTimeout(() => remove(id), 3000)
    },
    [remove]
  )

  const success = useCallback((message) => push('success', message), [push])
  const error = useCallback((message) => push('error', message), [push])

  return (
    <ToastContext.Provider value={{ success, error }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-[calc(100vw-2rem)]">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`glass-panel px-4 py-3 text-sm shadow-glass border-l-4 min-w-[220px]
              ${t.type === 'success' ? 'border-l-ios-green' : 'border-l-ios-red'}`}
          >
            <div className="flex items-start gap-2">
              <span className="flex-1 text-text-body">{t.message}</span>
              <button
                type="button"
                onClick={() => remove(t.id)}
                className="text-text-low hover:text-text-body leading-none"
                aria-label="Tutup"
              >
                &times;
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast harus dipakai di dalam ToastProvider')
  return ctx
}
