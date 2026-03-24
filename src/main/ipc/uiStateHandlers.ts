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
import { ipcMain } from 'electron'
import { loadUIState, patchUIState } from '../services/UIStateService'
import type { UIState } from '../services/UIStateService'

export function registerUIStateHandlers(): void {
  ipcMain.handle('uiState:get', () => {
    return loadUIState()
  })

  ipcMain.handle('uiState:patch', (_event, partial: Partial<UIState>) => {
    patchUIState(partial)
  })
}
