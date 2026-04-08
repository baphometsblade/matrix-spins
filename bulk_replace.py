import glob
import os

files = glob.glob(r'C:/created games/Casino/games/*.html')
print(f'Found {len(files)} files')

replacements = [
    # data-studio attributes
    ('data-studio="novaplay"', 'data-studio="nebula-gaming"'),
    ('data-studio="goldenedge"', 'data-studio="golden-reels"'),
    ('data-studio="celestial"', 'data-studio="mythic-forge"'),
    ('data-studio="ironreel"', 'data-studio="ironclad"'),
    ('data-studio="phantomworks"', 'data-studio="shadow-works"'),
    ('data-studio="arcadeforge"', 'data-studio="wild-frontier"'),
    ('data-studio="thunderbolt"', 'data-studio="cascade-labs"'),
    ('data-studio="vortexspin"', 'data-studio="dragon-pearl"'),
    # Display names (order matters - do longer/more specific first)
    ('NovaPlay Studios', 'Nebula Gaming'),
    ('GoldenEdge Gaming', 'Golden Reels Studio'),
    ('Celestial Plays', 'Mythic Forge'),
    ('IronReel Entertainment', 'Ironclad Entertainment'),
    ('PhantomWorks', 'Shadow Works'),
    ('ArcadeForge', 'Wild Frontier Games'),
    ('ThunderBolt Games', 'Cascade Labs'),
    ('VortexSpin', 'Dragon Pearl Studios'),
    # Short names (longer/more specific first to avoid partial matches)
    ('PHANTOMWORKS', 'SHADOW WORKS'),
    ('PHANTOM', 'SHADOW WORKS'),
    ('ARCADEFORGE', 'WILD FRONTIER'),
    ('ARCADE', 'WILD FRONTIER'),
    ('VORTEXSPIN', 'DRAGON PEARL'),
    ('VORTEX', 'DRAGON PEARL'),
    ('NOVAPLAY', 'NEBULA'),
    ('GOLDENEDGE', 'GOLDEN REELS'),
    ('CELESTIAL', 'MYTHIC FORGE'),
    ('IRONREEL', 'IRONCLAD'),
    ('THUNDERBOLT', 'CASCADE'),
    # Casino name (longer first to avoid double-replacement)
    ('Matrix Spins Casino', 'Royal Slots Casino'),
    ('Matrix Spins', 'Royal Slots'),
]

modified = 0
for fpath in sorted(files):
    with open(fpath, 'r', encoding='utf-8') as f:
        content = f.read()
    original = content
    for old, new in replacements:
        content = content.replace(old, new)
    if content != original:
        with open(fpath, 'w', encoding='utf-8') as f:
            f.write(content)
        modified += 1
        print(f'  Modified: {os.path.basename(fpath)}')

print(f'\nTotal modified: {modified} / {len(files)} files')
