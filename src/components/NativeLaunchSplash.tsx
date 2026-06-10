import { useEffect, useState } from 'react'
import appIcon from '../assets/burillab_app_icon.png'

const SPLASH_DURATION_MS = 1450

export function NativeLaunchSplash() {
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsVisible(false)
    }, SPLASH_DURATION_MS)

    return () => window.clearTimeout(timer)
  }, [])

  if (!isVisible) {
    return null
  }

  return (
    <div className="native-launch-splash" aria-hidden="true">
      <div className="native-launch-splash__stage">
        <div className="native-launch-splash__mark-shell">
          <span className="native-launch-splash__accent native-launch-splash__accent--red" />
          <span className="native-launch-splash__accent native-launch-splash__accent--yellow" />
          <span className="native-launch-splash__accent native-launch-splash__accent--blue" />
          <img
            src={appIcon}
            alt=""
            className="native-launch-splash__mark"
            draggable={false}
          />
        </div>
        <div className="native-launch-splash__wordmark">버릴랩</div>
        <div className="native-launch-splash__progress">
          <span />
        </div>
      </div>
    </div>
  )
}
