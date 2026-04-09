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
import { useState } from 'react'

interface WelcomePopupProps {
  onClose: (dontShowAgain: boolean) => void
}

function WelcomePopup({ onClose }: WelcomePopupProps): React.JSX.Element {
  const [dontShow, setDontShow] = useState(false)

  return (
    <div className="welcome-overlay">
      <div className="welcome-popup">
        <div className="welcome-header">
          <span className="welcome-logo-icon">B</span>
          <span className="welcome-logo-text">Bernard</span>
        </div>
        <div className="welcome-body">
          <p>
            Welcome! To help you get started, the current profile is set to a{' '}
            <strong>demo profile</strong>, which includes examples of commands, agents,
            skills, and tools that you may use as templates for your own.
          </p>
          <p>
            You can switch to your own profile by configuring a custom profile directory
            in the <strong>Settings</strong> tab.
          </p>
        </div>
        <p className="welcome-note">Thank you for choosing Bernard — happy exploring!</p>
        <div className="welcome-footer">
          <label className="settings-checkbox-label">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
            />
            Don&apos;t show this welcome message at startup
          </label>
          <button
            className="skills-tab-save-button"
            onClick={() => onClose(dontShow)}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default WelcomePopup
