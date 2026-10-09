// "Beenden" mit Sicherheitsabfrage: erster Klick scharf stellen, zweiter (innerhalb von 4 s) beendet und speichert.
import { useEffect, useState } from 'react'
import { finishWorkout } from '../engine/player'

export default function EndButton() {
  const [arm, setArm] = useState(false)
  useEffect(() => {
    if (!arm) return
    const t = setTimeout(() => setArm(false), 4000)
    return () => clearTimeout(t)
  }, [arm])
  return arm
    ? <button className="btn danger big" onClick={finishWorkout}>Wirklich beenden &amp; speichern?</button>
    : <button className="btn danger big" onClick={() => setArm(true)}>■ Beenden</button>
}
