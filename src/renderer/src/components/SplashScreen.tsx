/*
 * Copyright 2026 Christoph von Praun
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
interface SplashScreenProps {
  fading: boolean
  statusMessage?: string
}

function SplashScreen({ fading, statusMessage }: SplashScreenProps): React.JSX.Element {
  return (
    <div className={`splash-overlay ${fading ? 'splash-fading' : ''}`}>
      <div className="splash-content">
        <div className="splash-logo">
          <span className="splash-logo-icon">B</span>
          <h1 className="splash-title">Bernard</h1>
        </div>
        <p className="splash-credit">Version 1.0.0 &middot; March 2026</p>
      </div>
      <div className="splash-statusbar">
        <div className="splash-spinner" />
        <p className="splash-status">{statusMessage || 'Starting...'}</p>
        {statusMessage?.includes('Connecting MCP') && (
          <p className="splash-status"> - press ESC to skip</p>
        )}
      </div>
    </div>
  )
}

export default SplashScreen
