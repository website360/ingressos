"use client";

import * as React from "react";

/** Estado da conexão. Dispara a sincronização da fila quando a rede volta. */
export function useOnlineStatus(onReconnect?: () => void) {
  const [isOnline, setIsOnline] = React.useState(true);
  const callback = React.useRef(onReconnect);
  callback.current = onReconnect;

  React.useEffect(() => {
    setIsOnline(navigator.onLine);

    function handleOnline() {
      setIsOnline(true);
      callback.current?.();
    }
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
