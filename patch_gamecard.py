import sys

content = open('js/ui-lobby.js', 'r', encoding='utf-8').read()
idx = content.find('_seedCount(game.id, isHot || _hotIds.has(game.id));')
end = content.find('        }\n\n\n        function playRandomHotGame()', idx)

if idx < 0 or end < 0:
    print('ERROR: anchor not found. idx=%d end=%d' % (idx, end))
    sys.exit(1)

old_section = content[idx:end]
print('Old section length:', len(old_section))

new_section = r"""_seedCount(game.id, isHot || _hotIds.has(game.id));
            // RTP chip
            const rtpChip = game.rtp
                ? '<span class="game-chip game-chip-rtp">' + game.rtp + '% RTP</span>'
                : '';
            // Max win chip
            var maxWinChip = maxWin > 0
                ? '<span class="game-chip game-chip-maxwin">' + (maxWin >= 1000 ? (maxWin/1000).toFixed(1) + 'K' : maxWin) + 'x MAX</span>'
                : '';
            // Mechanic chip from bonusType
            const mechanicLabel = game.bonusType
                ? game.bonusType.replace(/_/g, ' ').replace(/\b\w/g, function(c){ return c.toUpperCase(); })
                : '';
            const mechanicChip = mechanicLabel
                ? '<span class="game-chip">' + mechanicLabel + '</span>'
                : '';
            // Studio dot color
            const studioAccent = _getProviderAccent(game.provider);
            return `
                <div class="game-card${isHot ? ' game-card-hot' : ''}${isJackpot ? ' game-card-jackpot is-jackpot' : ''}${gameDayCardClass}" onclick="try{if(typeof _compareMode!=='undefined'&&_compareMode){_addToCompare('${game.id}');this.classList.toggle('compare-selected',typeof _compareGames!=='undefined'&&_compareGames.indexOf('${game.id}')>=0);}else{(window.openSlot||openSlot)('${game.id}');}}catch(e){console.warn('Game click error:',e.message);}" style="position:relative" data-game-name="${(game.name || game.id || '').toLowerCase()}" data-game-id="${(game.id || '').toLowerCase()}">
                    <button class="fav-btn${favored ? ' fav-active' : ''}" data-game-id="${game.id}" title="${favored ? 'Remove from favourites' : 'Add to favourites'}" onclick="event.stopPropagation(); (function(btn){var nowFav=toggleFavorite('${game.id}'); btn.textContent=nowFav?'\u2764\uFE0F':'\u2661'; btn.title=nowFav?'Remove from favourites':'Add to favourites'; btn.classList.add('fav-active'); setTimeout(function(){btn.classList.remove('fav-active');},350); updateFavTabBadge();})(this)">${favIcon}</button>
                    <div class="game-card-art" style="${thumbStyle}"${thumbDataBg}>
                        ${hasThumbnail ? '<img src="" loading="lazy" decoding="async" alt="${escapeHtml(game.name)}">' : (!game.thumbnail && game.asset ? (assetTemplates[game.asset] || '') : '')}
                        <div class="card-anim-preview" style="background-image:url('assets/backgrounds/slots/${game.id}_bg.webp')" onerror="this.classList.add('hidden')">
                            <span class="preview-badge">&#9654; PREVIEW</span>
                        </div>
                        ${topTag}
                        ${jackpotBadge}
                        <div class="card-players-live" data-game="${game.id}"> ${_getLiveCount(game.id)} playing</div>
                        ${(function() { try { var _v = parseFloat(localStorage.getItem('personalBest_' + game.id) || '0'); if (_v > 0) { var _disp = _v >= 1000 ? ('$' + (_v/1000).toFixed(1) + 'K') : ('$' + Math.round(_v)); return '<div class="card-personal-best">\u{1F3C6} PB ' + _disp + '</div>'; } } catch(e) {} return ''; })()}
                        <div class="game-vol-badge ${volClass}" title="Volatility: ${vol}">
                            ${dotsHtml}
                        </div>
                        <div class="game-card-overlay">
                            <button class="game-overlay-play" onclick="event.stopPropagation();(window.openSlot||openSlot)('${game.id}')">PLAY NOW</button>
                            <button class="game-overlay-demo" onclick="event.stopPropagation();(window.openSlot||openSlot)('${game.id}')">Try Demo</button>
                        </div>
                        <div class="gi-strip">
                            <span class="gi-grid">${game.gridCols}\xd7${game.gridRows}</span>
                            <span class="gi-bonus">${_giBonusLabel(game)}</span>
                            <span class="gi-vol ${_giVolatility(game).cls}" title="Volatility: ${_giVolatility(game).label}">${_giVolatility(game).dots}</span>
                        </div>
                    </div>
                    <div class="game-card-info">
                        <div class="game-card-name">${escapeHtml(game.name)}</div>
                        <div class="game-card-studio">
                            <span class="game-card-studio-dot" style="background:${studioAccent}"></span>
                            <span style="color:${studioAccent}">${_getProviderLogo(game.provider)} ${escapeHtml(game.provider || '')}</span>
                        </div>
                        <div class="game-card-chips">
                            ${rtpChip}${maxWinChip}${mechanicChip}
                        </div>
                    </div>
                    ${_hotIds.has(game.id) ? '<span class="lobby-badge lobby-badge-hot">\uD83D\uDD25 HOT</span>' : ''}
                    ${_newIds.has(game.id) ? '<span class="lobby-badge lobby-badge-new">\u2728 NEW</span>' : ''}
                    ${gameDayBadgeHtml}
                    ${hotColdHtml}
                    ${maxWinHtml}
                </div>
            `;
        }"""

new_content = content[:idx] + new_section + content[end:]
open('js/ui-lobby.js', 'w', encoding='utf-8').write(new_content)
print('SUCCESS - replaced %d chars with %d chars' % (len(old_section), len(new_section)))
