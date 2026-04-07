/**
 * Keyboard Shortcuts Module
 * Provides keyboard shortcuts for the Royal Slots Casino game
 */

(function() {
  'use strict';

  const KeyboardShortcuts = {
    initialized: false,
    helpOverlayId: 'keyboard-shortcuts-help',

    /**
     * Keyboard shortcut definitions
     */
    shortcuts: [
      { key: 'Space', action: 'Spin', description: 'Trigger the spin button' },
      { key: 'S', action: 'Toggle Sound', description: 'Toggle sound on/off' },
      { key: 'H', action: 'Show Help', description: 'Show shortcut help overlay' },
      { key: 'Escape', action: 'Close Modal', description: 'Close any open modal' },
      { key: 'M', action: 'Toggle Mute', description: 'Toggle mute' },
      { key: 'F', action: 'Toggle Fullscreen', description: 'Toggle fullscreen mode' },
      { key: 'L', action: 'Open Lobby', description: 'Open lobby/game list' },
      { key: 'B', action: 'Bankroll Calc', description: 'Open bankroll calculator' },
      { key: '?', action: 'Show Help', description: 'Show shortcut help overlay' }
    ],

    /**
     * Initialize keyboard shortcuts
     */
    init: function() {
      if (this.initialized) {
        console.warn('KeyboardShortcuts already initialized');
        return;
      }

      document.addEventListener('keydown', (e) => this._handleKeyDown(e));
      this.initialized = true;
      console.warn('KeyboardShortcuts initialized');
    },

    /**
     * Handle keydown events
     */
    _handleKeyDown: function(e) {
      // Don't trigger if focus is on input or textarea
      const activeElement = document.activeElement;
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
        return;
      }

      const key = e.key;
      const shiftKey = e.shiftKey;

      // Handle ? (Shift + /)
      if (key === '?' || (shiftKey && key === '/')) {
        e.preventDefault();
        this.showHelp();
        return;
      }

      // Handle Space
      if (key === ' ') {
        e.preventDefault();
        this._triggerSpin();
        return;
      }

      // Handle S (toggle sound)
      if (key.toLowerCase() === 's') {
        e.preventDefault();
        this._toggleSound();
        return;
      }

      // Handle H (show help)
      if (key.toLowerCase() === 'h') {
        e.preventDefault();
        this.showHelp();
        return;
      }

      // Handle Escape (close modal)
      if (key === 'Escape') {
        e.preventDefault();
        this._closeModal();
        return;
      }

      // Handle M (toggle mute)
      if (key.toLowerCase() === 'm') {
        e.preventDefault();
        this._toggleMute();
        return;
      }

      // Handle F (toggle fullscreen)
      if (key.toLowerCase() === 'f') {
        e.preventDefault();
        this._toggleFullscreen();
        return;
      }

      // Handle L (open lobby)
      if (key.toLowerCase() === 'l') {
        e.preventDefault();
        this._openLobby();
        return;
      }

      // Handle B (open bankroll calculator)
      if (key.toLowerCase() === 'b') {
        e.preventDefault();
        this._openBankrollCalculator();
        return;
      }
    },

    /**
     * Trigger spin action
     */
    _triggerSpin: function() {
      // Check if a modal is open
      if (this._isModalOpen()) {
        console.warn('Modal is open, ignoring spin command');
        return;
      }

      const spinButton = document.querySelector('[data-action="spin"], .spin-button, #spin-btn, button:contains("Spin")');
      if (spinButton) {
        spinButton.click();
        console.warn('Spin triggered via keyboard shortcut');
      } else {
        console.warn('Spin button not found');
      }
    },

    /**
     * Toggle sound
     */
    _toggleSound: function() {
      if (window.SoundSettings && typeof window.SoundSettings.toggleSound === 'function') {
        window.SoundSettings.toggleSound();
        console.warn('Sound toggled via keyboard shortcut');
      } else if (window.toggleSound && typeof window.toggleSound === 'function') {
        window.toggleSound();
        console.warn('Sound toggled via keyboard shortcut');
      } else {
        console.warn('Sound toggle function not found');
      }
    },

    /**
     * Toggle mute
     */
    _toggleMute: function() {
      if (window.SoundSettings && typeof window.SoundSettings.toggleMute === 'function') {
        window.SoundSettings.toggleMute();
        console.warn('Mute toggled via keyboard shortcut');
      } else if (window.toggleMute && typeof window.toggleMute === 'function') {
        window.toggleMute();
        console.warn('Mute toggled via keyboard shortcut');
      } else {
        console.warn('Mute toggle function not found');
      }
    },

    /**
     * Toggle fullscreen
     */
    _toggleFullscreen: function() {
      const elem = document.documentElement;
      if (!document.fullscreenElement) {
        elem.requestFullscreen().catch(err => {
          console.warn('Fullscreen request failed:', err.message);
        });
      } else {
        document.exitFullscreen().catch(err => {
          console.warn('Exit fullscreen failed:', err.message);
        });
      }
      console.warn('Fullscreen toggled via keyboard shortcut');
    },

    /**
     * Open lobby/game list
     */
    _openLobby: function() {
      if (this._isModalOpen()) {
        console.warn('Modal is open, ignoring lobby command');
        return;
      }

      if (window.GameLobby && typeof window.GameLobby.open === 'function') {
        window.GameLobby.open();
        console.warn('Lobby opened via keyboard shortcut');
      } else {
        console.warn('Game lobby not available');
      }
    },

    /**
     * Open bankroll calculator
     */
    _openBankrollCalculator: function() {
      if (this._isModalOpen()) {
        console.warn('Modal is open, ignoring bankroll calculator command');
        return;
      }

      if (window.BankrollCalculator && typeof window.BankrollCalculator.open === 'function') {
        window.BankrollCalculator.open();
        console.warn('Bankroll calculator opened via keyboard shortcut');
      } else {
        console.warn('Bankroll calculator not available');
      }
    },

    /**
     * Close modal
     */
    _closeModal: function() {
      // Close help overlay if open
      const helpOverlay = document.getElementById(this.helpOverlayId);
      if (helpOverlay) {
        this._removeHelpOverlay();
        return;
      }

      // Try common modal close methods
      if (window.Bootstrap && window.Bootstrap.Modal) {
        const modals = document.querySelectorAll('.modal.show');
        modals.forEach(modal => {
          const bsModal = window.bootstrap.Modal.getInstance(modal);
          if (bsModal) {
            bsModal.hide();
          }
        });
      }

      // Try jQuery modal
      if (window.jQuery) {
        window.jQuery('.modal.show').modal('hide');
      }

      // Try closing any open dialog
      const dialogs = document.querySelectorAll('[role="dialog"][open], .modal.show, .dialog.open');
      dialogs.forEach(dialog => {
        if (dialog.close) {
          dialog.close();
        } else {
          dialog.classList.remove('show', 'open');
          if (dialog.style.display) {
            dialog.style.display = 'none';
          }
        }
      });

      console.warn('Close modal triggered via keyboard shortcut');
    },

    /**
     * Check if a modal is open
     */
    _isModalOpen: function() {
      // Check for help overlay
      if (document.getElementById(this.helpOverlayId)) {
        return true;
      }

      // Check for Bootstrap modals
      if (document.querySelector('.modal.show')) {
        return true;
      }

      // Check for dialog elements
      if (document.querySelector('[role="dialog"][open]')) {
        return true;
      }

      // Check for generic modal classes
      if (document.querySelector('.modal.open, .dialog.open')) {
        return true;
      }

      return false;
    },

    /**
     * Show help overlay with keyboard shortcuts
     */
    showHelp: function() {
      // Remove existing overlay if present
      this._removeHelpOverlay();

      // Create overlay container
      const overlay = document.createElement('div');
      overlay.id = this.helpOverlayId;
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.7);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
        animation: fadeIn 0.3s ease-in;
      `;

      // Create card
      const card = document.createElement('div');
      card.style.cssText = `
        background-color: #fff;
        border-radius: 12px;
        padding: 30px;
        max-width: 600px;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
        animation: slideUp 0.3s ease-out;
      `;

      // Add title
      const title = document.createElement('h2');
      title.textContent = 'Keyboard Shortcuts';
      title.style.cssText = `
        margin-top: 0;
        margin-bottom: 20px;
        font-size: 24px;
        color: #333;
        font-weight: 600;
      `;
      card.appendChild(title);

      // Create grid container
      const grid = document.createElement('div');
      grid.style.cssText = `
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
        margin-bottom: 20px;
      `;

      // Add shortcuts to grid
      this.shortcuts.forEach(shortcut => {
        const item = document.createElement('div');
        item.style.cssText = `
          padding: 12px;
          background-color: #f5f5f5;
          border-radius: 6px;
          border-left: 4px solid #007bff;
        `;

        const keyElement = document.createElement('div');
        keyElement.style.cssText = `
          font-weight: 600;
          color: #007bff;
          font-size: 14px;
          margin-bottom: 4px;
          font-family: monospace;
        `;
        keyElement.textContent = shortcut.key;

        const actionElement = document.createElement('div');
        actionElement.style.cssText = `
          color: #666;
          font-size: 13px;
          line-height: 1.4;
        `;
        actionElement.textContent = shortcut.description;

        item.appendChild(keyElement);
        item.appendChild(actionElement);
        grid.appendChild(item);
      });

      card.appendChild(grid);

      // Add close instruction
      const closeInfo = document.createElement('div');
      closeInfo.style.cssText = `
        text-align: center;
        color: #999;
        font-size: 12px;
        margin-top: 20px;
        padding-top: 20px;
        border-top: 1px solid #eee;
      `;
      closeInfo.textContent = 'Press ESC or click outside to close';
      card.appendChild(closeInfo);

      overlay.appendChild(card);
      document.body.appendChild(overlay);

      // Add CSS animations
      const style = document.createElement('style');
      style.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `;
      if (!document.querySelector('style[data-keyboard-shortcuts]')) {
        style.setAttribute('data-keyboard-shortcuts', 'true');
        document.head.appendChild(style);
      }

      // Close on ESC key
      const closeHandler = (e) => {
        if (e.key === 'Escape') {
          this._removeHelpOverlay();
          document.removeEventListener('keydown', closeHandler);
        }
      };
      document.addEventListener('keydown', closeHandler);

      // Close on background click
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          this._removeHelpOverlay();
        }
      });

      console.warn('Keyboard shortcuts help displayed');
    },

    /**
     * Remove help overlay
     */
    _removeHelpOverlay: function() {
      const overlay = document.getElementById(this.helpOverlayId);
      if (overlay) {
        overlay.remove();
      }
    }
  };

  // Expose to window
  window.KeyboardShortcuts = {
    init: () => KeyboardShortcuts.init(),
    showHelp: () => KeyboardShortcuts.showHelp()
  };

  console.warn('KeyboardShortcuts module loaded');
})();
