import os
import sqlite3
import subprocess
import logging
import uuid
import time
import re
import sys
import json
import threading
import shutil
import psutil
import platform
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, redirect, url_for, session, send_file, send_from_directory
from werkzeug.utils import secure_filename
from functools import wraps
import bcrypt

app = Flask(__name__)
app.secret_key = os.urandom(24)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024

# Add custom Jinja2 filter for absolute value
@app.template_filter('abs')
def abs_filter(value):
    return abs(value)

ALLOWED_EXTENSIONS = {'py'}

# Use absolute paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
LOG_FOLDER = os.path.join(BASE_DIR, 'logs')
INSTALLED_MODULES_FOLDER = os.path.join(BASE_DIR, 'installed_modules')
INSTALLED_CACHE_FILE = os.path.join(BASE_DIR, 'installed_packages.json')
STATIC_FOLDER = os.path.join(BASE_DIR, 'static')  # New: for JS/CSS files

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(LOG_FOLDER, exist_ok=True)
os.makedirs(INSTALLED_MODULES_FOLDER, exist_ok=True)
os.makedirs(STATIC_FOLDER, exist_ok=True)  # New: create static folder

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DB_PATH = os.path.join(BASE_DIR, 'bots.db')
running_bots = {}
bot_start_times = {}

# ========== IMPORT TO PIP PACKAGE MAPPING ==========
IMPORT_TO_PIP = {
    'telegram': 'python-telegram-bot',
    'telegram.ext': 'python-telegram-bot',
    'telegram.error': 'python-telegram-bot',
    'requests': 'requests',
    'aiohttp': 'aiohttp',
    'httpx': 'httpx',
    'pandas': 'pandas',
    'numpy': 'numpy',
    'PIL': 'pillow',
    'cv2': 'opencv-python',
    'bs4': 'beautifulsoup4',
    'yaml': 'pyyaml',
    'dotenv': 'python-dotenv',
    'python_dotenv': 'python-dotenv',
    'redis': 'redis',
    'pymongo': 'pymongo',
    'psycopg2': 'psycopg2-binary',
    'sqlalchemy': 'sqlalchemy',
    'flask': 'flask',
    'django': 'django',
    'fastapi': 'fastapi',
    'discord': 'discord.py',
    'nextcord': 'nextcord',
    'pycord': 'py-cord',
    'web3': 'web3',
    'web3.auto': 'web3',
    'web3.middleware': 'web3',
    'web3.providers': 'web3',
    'eth_account': 'eth-account',
    'eth_keys': 'eth-keys',
    'eth_utils': 'eth-utils',
    'eth_typing': 'eth-typing',
    'eth_hash': 'eth-hash',
    'eth_abi': 'eth-abi',
    'hexbytes': 'hexbytes',
    'solana': 'solana',
    'solana.publickey': 'solana',
    'solana.keypair': 'solana',
    'solana.rpc': 'solana',
    'solders': 'solders',
    'anchorpy': 'anchorpy',
    'bitcoin': 'bitcoin',
    'bit': 'bit',
    'bitcoinlib': 'bitcoinlib',
    'bitcointx': 'bitcointx',
    'ccxt': 'ccxt',
    'binance': 'python-binance',
    'binance.client': 'python-binance',
    'binance.streams': 'python-binance',
    'coinbase': 'coinbase',
    'coinbase.wallet': 'coinbase',
    'coinbase.rest': 'coinbase',
    'kucoin': 'kucoin-python',
    'bybit': 'pybit',
    'okx': 'okx-python-sdk',
    'huobi': 'huobi',
    'gateio': 'gate-api',
    'kraken': 'krakenex',
    'bitget': 'bitget',
    'bingx': 'bingx',
    'mexc': 'mexc',
    'coingecko': 'pycoingecko',
    'coinmarketcap': 'coinmarketcap',
    'cryptocompare': 'cryptocompare',
    'coinpaprika': 'coinpaprika',
    'dexscreener': 'dexscreener',
    'dextools': 'dextools',
    'uniswap': 'uniswap-python',
    'uniswap.v3': 'uniswap-python',
    'pancakeswap': 'pancakeswap',
    'curve': 'curve',
    'aave': 'aave',
    'compound': 'compound',
    'balancer': 'balancer',
    'sushiswap': 'sushiswap',
    'mnemonic': 'mnemonic',
    'bip32': 'bip32',
    'bip39': 'bip39',
    'hdwallet': 'hdwallet',
    'coincurve': 'coincurve',
    'cryptography': 'cryptography',
    'ecdsa': 'ecdsa',
    'pynacl': 'pynacl',
    'secp256k1': 'secp256k1',
    'base58': 'base58',
    'bech32': 'bech32',
    'crypto': 'crypto',
    'pycrypto': 'pycrypto',
    'pycryptodome': 'pycryptodome',
    'Cryptodome': 'pycryptodome',
    'Crypto': 'pycryptodome',
    'vyper': 'vyper',
    'brownie': 'brownie',
    'ape': 'ape',
    'truffle': 'truffle',
    'hardhat': 'hardhat',
    'slither': 'slither-analyzer',
    'erc20': 'erc20',
    'erc721': 'erc721',
    'erc1155': 'erc1155',
    'bep20': 'bep20',
    'polygon': 'polygon',
    'arbitrum': 'arbitrum',
    'optimism': 'optimism',
    'zksync': 'zksync',
    'starknet': 'starknet.py',
    'nft': 'nft',
    'opensea': 'opensea-py',
    'rarible': 'rarible',
    'magiceden': 'magiceden',
    'blur': 'blur',
    'chainlink': 'chainlink',
    'pyth': 'pyth',
    'duneanalytics': 'duneanalytics',
    'nansen': 'nansen',
    'glassnode': 'glassnode',
    'intotheblock': 'intotheblock',
    'lunarcrush': 'lunarcrush',
    'santiment': 'santiment',
    'flashbots': 'flashbots',
    'mev': 'mev',
    'wormhole': 'wormhole',
    'layerzero': 'layerzero',
    'axelar': 'axelar',
    'websockets': 'websockets',
    'web3_utils': 'web3-utils',
    'eth_rpc': 'eth-rpc',
    'langchain': 'langchain',
    'openai': 'openai',
    'tweepy': 'tweepy',
    'discord_webhook': 'discord-webhook',
}

# Python standard library modules
STANDARD_LIBRARY = {
    'os', 'sys', 're', 'json', 'time', 'datetime', 'logging', 'threading',
    'subprocess', 'sqlite3', 'pathlib', 'glob', 'math', 'random', 'string',
    'collections', 'itertools', 'functools', 'typing', 'abc', 'copy', 'hashlib',
    'hmac', 'tempfile', 'inspect', 'traceback', 'socket', 'select', 'ssl',
    'email', 'http', 'urllib', 'xml', 'csv', 'io', 'base64', 'binascii',
    'struct', 'array', 'queue', 'weakref', 'contextlib', 'dataclasses',
    'enum', 'codecs', 'gettext', 'locale', 'argparse', 'optparse',
    'configparser', 'pickle', 'shelve', 'dbm', 'zlib', 'gzip', 'bz2', 'lzma',
    'zipfile', 'tarfile', 'shutil', 'filecmp', 'fnmatch', 'linecache', 'stat',
    'asyncio', 'concurrent', 'multiprocessing', 'signal', 'atexit', 'ctypes',
    'platform', 'pprint', 'pydoc', 'queue', 'secrets', 'socketserver',
    'stringprep', 'textwrap', 'timeit', 'types', 'unicodedata', 'unittest',
    'urllib', 'uuid', 'warnings', 'weakref', 'zipimport',
}

# ========== DATABASE SETUP ==========
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email TEXT,
        is_admin INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
    )''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS bots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        bot_token TEXT NOT NULL,
        bot_name TEXT NOT NULL,
        bot_id TEXT UNIQUE NOT NULL,
        bot_file_path TEXT NOT NULL,
        status TEXT DEFAULT 'stopped',
        pid INTEGER,
        total_messages INTEGER DEFAULT 0,
        error_message TEXT,
        deps_installed INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS activity_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        action TEXT,
        bot_id TEXT,
        details TEXT,
        ip_address TEXT,
        level TEXT DEFAULT 'info',
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    
    # Create default admin
    c.execute("SELECT * FROM users WHERE username = 'admin'")
    if not c.fetchone():
        hashed = bcrypt.hashpw('admin123'.encode('utf-8'), bcrypt.gensalt())
        c.execute("INSERT INTO users (username, password, email, is_admin) VALUES (?, ?, ?, ?)",
                 ('admin', hashed.decode('utf-8'), 'admin@bothost.com', 1))
    
    conn.commit()
    conn.close()

init_db()

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def detect_imports(file_path):
    """Detect all imports from a Python file"""
    imports = set()
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        
        # Remove comments and strings
        content = re.sub(r'#.*$', '', content, flags=re.MULTILINE)
        content = re.sub(r'""".*?"""', '', content, flags=re.DOTALL)
        content = re.sub(r"'''.*?'''", '', content, flags=re.DOTALL)
        
        # Pattern matching
        pattern1 = r'^import\s+([a-zA-Z0-9_\.]+)'
        pattern2 = r'^from\s+([a-zA-Z0-9_\.]+)\s+import'
        
        for line in content.split('\n'):
            line = line.strip()
            if not line:
                continue
            
            for pattern in [pattern1, pattern2]:
                matches = re.findall(pattern, line)
                for match in matches:
                    module = match.split('.')[0]
                    if module not in STANDARD_LIBRARY and len(module) > 1 and not module.startswith('_'):
                        imports.add(module)
    
    except Exception as e:
        logger.error(f"Error detecting imports: {e}")
    
    return imports

def get_pip_name(import_name):
    """Convert import name to pip package name"""
    if import_name in IMPORT_TO_PIP:
        return IMPORT_TO_PIP[import_name]
    return import_name.replace('_', '-')

def load_installed_cache():
    """Load the local package cache from disk"""
    try:
        if os.path.exists(INSTALLED_CACHE_FILE):
            with open(INSTALLED_CACHE_FILE, 'r') as f:
                return json.load(f)
    except Exception:
        pass
    return {}

def save_installed_cache(cache):
    """Save the local package cache to disk"""
    try:
        with open(INSTALLED_CACHE_FILE, 'w') as f:
            json.dump(cache, f, indent=2)
    except Exception as e:
        logger.error(f"Failed to save package cache: {e}")

def install_module(module):
    """Install a module with correct package name, using local cache to skip redundant checks"""
    pip_name = get_pip_name(module)
    cache = load_installed_cache()

    # Skip entirely if already recorded in local cache
    if pip_name in cache:
        return "already_installed (cached)"

    try:
        # Check via pip show before attempting install
        result = subprocess.run(
            [sys.executable, '-m', 'pip', 'show', pip_name],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            cache[pip_name] = True
            save_installed_cache(cache)
            return "already_installed"

        # Install the package
        result = subprocess.run(
            [sys.executable, '-m', 'pip', 'install', '--no-cache-dir', pip_name],
            capture_output=True, text=True, timeout=120
        )

        if result.returncode == 0:
            cache[pip_name] = True
            save_installed_cache(cache)
            return "installed"
        else:
            return f"failed: {result.stderr[:200]}"

    except subprocess.TimeoutExpired:
        return "timeout"
    except Exception as e:
        return f"error: {str(e)}"

def auto_install_deps_with_status(bot_file_path, log_path, bot_id):
    """Auto install dependencies and update status when done"""
    imports = detect_imports(bot_file_path)
    
    with open(log_path, 'a') as log:
        log.write(f"\n{'='*60}\n")
        log.write(f"📦 Starting dependency installation at {datetime.now()}\n")
        log.write(f"Found {len(imports)} external dependencies\n\n")
        
        for module in imports:
            result = install_module(module)
            log.write(f"  {module}: {result}\n")
    
    # Mark as installed
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE bots SET deps_installed = 1 WHERE bot_id = ?", (bot_id,))
    conn.commit()
    conn.close()
    
    with open(log_path, 'a') as log:
        log.write(f"\n✅ Dependency installation completed at {datetime.now()}\n")
        log.write(f"{'='*60}\n\n")

# ========== FILE MANAGEMENT ==========
def get_bot_directory(bot_id, user_id):
    bot = BotManager.get_bot(bot_id, user_id)
    if not bot:
        return None
    return os.path.dirname(bot['bot_file_path'])

def get_relative_path(bot_dir, request_path):
    if not request_path:
        return bot_dir
    safe_path = os.path.normpath(os.path.join(bot_dir, request_path))
    if not safe_path.startswith(bot_dir):
        return bot_dir
    return safe_path

def format_file_size(size):
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size < 1024.0:
            return f"{size:.1f} {unit}"
        size /= 1024.0
    return f"{size:.1f} TB"

# ========== BOT MANAGER ==========
class BotManager:
    """Complete Bot Manager Class for handling all bot operations"""
    
    @staticmethod
    def register_bot(user_id, bot_token, bot_name, bot_file):
        if not bot_file or not allowed_file(bot_file.filename):
            raise ValueError("Valid Python file (.py) is required")
        
        bot_id = str(uuid.uuid4())[:8]
        bot_dir = os.path.join(UPLOAD_FOLDER, bot_id)
        os.makedirs(bot_dir, exist_ok=True)
        
        filename = secure_filename(bot_file.filename)
        bot_file_path = os.path.join(bot_dir, filename)
        bot_file.save(bot_file_path)
        
        # Save to database
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("""INSERT INTO bots 
                     (user_id, bot_token, bot_name, bot_id, bot_file_path, deps_installed) 
                     VALUES (?, ?, ?, ?, ?, ?)""",
                 (user_id, bot_token, bot_name, bot_id, bot_file_path, 0))
        conn.commit()
        conn.close()
        
        # Setup log file
        log_path = os.path.join(LOG_FOLDER, f'{bot_id}.log')
        with open(log_path, 'w') as f:
            f.write(f"=== Bot '{bot_name}' Created ===\n")
            f.write(f"Bot ID: {bot_id}\n")
            f.write(f"Created at: {datetime.now()}\n")
            f.write(f"File: {bot_file_path}\n\n")
            f.write(f"📦 Detecting and installing dependencies...\n")
        
        # Start dependency installation with status tracking
        thread = threading.Thread(target=auto_install_deps_with_status, args=(bot_file_path, log_path, bot_id))
        thread.daemon = True
        thread.start()
        
        Database.log_activity(user_id, None, 'create_bot', bot_id, f"Bot created: {bot_name}", None)
        
        return {
            "bot_id": bot_id, 
            "bot_name": bot_name, 
            "status": "stopped",
            "deps_installed": 0,
            "message": "Bot created successfully. Dependencies are being installed in background."
        }
    
    @staticmethod
    def list_bots(user_id):
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("""SELECT bot_id, bot_name, status, total_messages, created_at, deps_installed
                     FROM bots WHERE user_id = ? ORDER BY created_at DESC""", (user_id,))
        rows = c.fetchall()
        conn.close()
        
        bots = []
        for row in rows:
            bots.append({
                "bot_id": row[0],
                "bot_name": row[1],
                "status": row[2],
                "total_messages": row[3] or 0,
                "created_at": row[4],
                "deps_installed": row[5] or 0
            })
        return bots
    
    @staticmethod
    def get_bot(bot_id, user_id=None):
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        
        if user_id:
            c.execute("""SELECT bot_id, bot_name, bot_token, status, bot_file_path, 
                                total_messages, error_message, created_at, deps_installed
                         FROM bots WHERE bot_id = ? AND user_id = ?""", 
                     (bot_id, user_id))
        else:
            c.execute("""SELECT bot_id, bot_name, bot_token, status, bot_file_path, 
                                total_messages, error_message, created_at, deps_installed, user_id 
                         FROM bots WHERE bot_id = ?""", (bot_id,))
        
        row = c.fetchone()
        conn.close()
        
        if row:
            result = {
                "bot_id": row[0],
                "bot_name": row[1],
                "bot_token": row[2],
                "status": row[3],
                "bot_file_path": row[4],
                "total_messages": row[5] or 0,
                "error_message": row[6],
                "created_at": row[7],
                "deps_installed": row[8] or 0
            }
            if not user_id and len(row) > 9:
                result["user_id"] = row[9]
            return result
        return None
    
    @staticmethod
    def get_bot_info(bot_id, user_id=None):
        """Get bot info for API responses"""
        bot = BotManager.get_bot(bot_id, user_id)
        if not bot:
            return None
        return {
            "bot_id": bot["bot_id"],
            "bot_name": bot["bot_name"],
            "status": bot["status"],
            "deps_installed": bot.get("deps_installed", 0) == 1,
            "total_messages": bot.get("total_messages", 0)
        }
    
    @staticmethod
    def check_deps_status(bot_id, user_id=None):
        """Check if dependencies are installed"""
        bot = BotManager.get_bot(bot_id, user_id)
        if not bot:
            return False
        return bot.get('deps_installed', 0) == 1
    
    @staticmethod
    def delete_bot(bot_id, user_id=None):
        bot = BotManager.get_bot(bot_id, user_id)
        if not bot:
            return False
        
        # Stop bot if running
        if bot_id in running_bots:
            try:
                running_bots[bot_id].terminate()
                running_bots[bot_id].wait(timeout=5)
                del running_bots[bot_id]
                if bot_id in bot_start_times:
                    del bot_start_times[bot_id]
            except:
                try:
                    running_bots[bot_id].kill()
                    del running_bots[bot_id]
                    if bot_id in bot_start_times:
                        del bot_start_times[bot_id]
                except:
                    pass
        
        # Delete bot directory
        bot_dir = os.path.dirname(bot['bot_file_path'])
        if os.path.exists(bot_dir):
            shutil.rmtree(bot_dir)
        
        # Delete log file
        log_path = os.path.join(LOG_FOLDER, f'{bot_id}.log')
        if os.path.exists(log_path):
            os.remove(log_path)
        
        # Delete from database
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        if user_id:
            c.execute("DELETE FROM bots WHERE bot_id = ? AND user_id = ?", (bot_id, user_id))
        else:
            c.execute("DELETE FROM bots WHERE bot_id = ?", (bot_id,))
        conn.commit()
        conn.close()
        
        if user_id:
            Database.log_activity(user_id, None, 'delete_bot', bot_id, f"Bot deleted: {bot['bot_name']}", None)
        
        return True
    
    @staticmethod
    def start_bot(bot_id, user_id=None):
        bot = BotManager.get_bot(bot_id, user_id)
        if not bot:
            return {"error": "Bot not found"}
        
        # Check if dependencies are installed
        if not bot.get('deps_installed', 0):
            return {"error": "Dependencies are still being installed. Please wait."}
        
        if bot_id in running_bots:
            return {"status": "already_running", "message": "Bot is already running"}
        
        if not os.path.exists(bot['bot_file_path']):
            return {"error": f"Bot file not found"}
        
        log_path = os.path.join(LOG_FOLDER, f'{bot_id}.log')
        bot_dir = os.path.dirname(bot['bot_file_path'])
        
        env = os.environ.copy()
        env['BOT_TOKEN'] = bot['bot_token']
        env['TELEGRAM_BOT_TOKEN'] = bot['bot_token']
        env['BOT_NAME'] = bot['bot_name']
        env['BOT_ID'] = bot['bot_id']
        env['PYTHONUNBUFFERED'] = '1'
        
        log_file = open(log_path, 'a', buffering=1)
        
        log_file.write(f"\n{'='*60}\n")
        log_file.write(f"🚀 Bot Started at {datetime.now()}\n")
        log_file.write(f"Bot Name: {bot['bot_name']}\n")
        log_file.write(f"Bot ID: {bot_id}\n")
        log_file.write(f"{'='*60}\n\n")
        log_file.flush()
        
        try:
            proc = subprocess.Popen(
                [sys.executable, '-u', bot['bot_file_path']],
                stdout=log_file,
                stderr=log_file,
                text=True,
                env=env,
                cwd=bot_dir
            )
            
            running_bots[bot_id] = proc
            bot_start_times[bot_id] = datetime.now()
            
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("UPDATE bots SET status = 'running', pid = ?, error_message = NULL WHERE bot_id = ?", 
                     (proc.pid, bot_id))
            conn.commit()
            conn.close()
            
            Database.log_activity(user_id or bot.get('user_id'), None, 'start_bot', bot_id, 
                                 f"Bot started with PID: {proc.pid}", None)
            
            return {"status": "started", "pid": proc.pid, "message": "Bot started successfully"}
            
        except Exception as e:
            log_file.write(f"\n❌ Failed to start bot: {str(e)}\n")
            log_file.flush()
            log_file.close()
            return {"error": f"Failed to start bot: {str(e)}"}
    
    @staticmethod
    def stop_bot(bot_id, user_id=None):
        bot = BotManager.get_bot(bot_id, user_id)
        
        if bot_id in running_bots:
            try:
                running_bots[bot_id].terminate()
                running_bots[bot_id].wait(timeout=5)
                del running_bots[bot_id]
                if bot_id in bot_start_times:
                    del bot_start_times[bot_id]
            except:
                try:
                    running_bots[bot_id].kill()
                    del running_bots[bot_id]
                    if bot_id in bot_start_times:
                        del bot_start_times[bot_id]
                except:
                    pass
        
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        if user_id:
            c.execute("UPDATE bots SET status = 'stopped', pid = NULL WHERE bot_id = ? AND user_id = ?", 
                     (bot_id, user_id))
        else:
            c.execute("UPDATE bots SET status = 'stopped', pid = NULL WHERE bot_id = ?", (bot_id,))
        conn.commit()
        conn.close()
        
        log_path = os.path.join(LOG_FOLDER, f'{bot_id}.log')
        if os.path.exists(log_path):
            with open(log_path, 'a') as f:
                f.write(f"\n⏹️ Bot Stopped at {datetime.now()}\n")
                f.write(f"{'='*60}\n\n")
        
        if bot:
            Database.log_activity(user_id or bot.get('user_id'), None, 'stop_bot', bot_id, "Bot stopped", None)
        
        return {"status": "stopped", "message": "Bot stopped successfully"}
    
    @staticmethod
    def restart_bot(bot_id, user_id=None):
        """Restart a bot (stop then start)"""
        bot = BotManager.get_bot(bot_id, user_id)
        if not bot:
            return {"error": "Bot not found"}
        
        # Check if dependencies are installed
        if not bot.get('deps_installed', 0):
            return {"error": "Dependencies are still being installed. Please wait."}
        
        # First stop the bot
        BotManager.stop_bot(bot_id, user_id)
        
        # Small delay to ensure clean shutdown
        time.sleep(2)
        
        # Then start it again
        start_result = BotManager.start_bot(bot_id, user_id)
        
        return {
            "status": "restarted",
            "message": "Bot restarted successfully",
            "start_result": start_result
        }
    
    @staticmethod
    def safe_restart_bot(bot_id, user_id=None):
        """Safely restart bot with file change detection"""
        bot = BotManager.get_bot(bot_id, user_id)
        if not bot:
            return {"error": "Bot not found"}
        
        was_running = bot_id in running_bots
        
        if was_running:
            # Stop the bot
            BotManager.stop_bot(bot_id, user_id)
            time.sleep(2)  # Wait for clean shutdown
        
        # Mark dependencies as not installed (they will be re-installed)
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("UPDATE bots SET deps_installed = 0 WHERE bot_id = ?", (bot_id,))
        conn.commit()
        conn.close()
        
        # Reinstall dependencies
        bot = BotManager.get_bot(bot_id, user_id)
        if bot:
            log_path = os.path.join(LOG_FOLDER, f'{bot_id}.log')
            thread = threading.Thread(target=auto_install_deps_with_status, args=(bot['bot_file_path'], log_path, bot_id))
            thread.daemon = True
            thread.start()
        
        # If it was running, restart it after deps install
        if was_running:
            # Wait a bit for deps to start installing
            time.sleep(3)
            start_result = BotManager.start_bot(bot_id, user_id)
            return {
                "status": "restarted",
                "message": "Bot restarted with new file. Dependencies are being reinstalled.",
                "start_result": start_result
            }
        
        return {"status": "updated", "message": "File updated. Bot was stopped."}
    
    @staticmethod
    def update_bot_file(bot_id, user_id, bot_file):
        bot = BotManager.get_bot(bot_id, user_id)
        if not bot:
            return {"error": "Bot not found"}
        
        if not bot_file or not allowed_file(bot_file.filename):
            return {"error": "Valid Python file (.py) is required"}
        
        if bot_id in running_bots:
            try:
                running_bots[bot_id].terminate()
                del running_bots[bot_id]
                if bot_id in bot_start_times:
                    del bot_start_times[bot_id]
            except:
                pass
        
        if os.path.exists(bot['bot_file_path']):
            os.remove(bot['bot_file_path'])
        
        filename = secure_filename(bot_file.filename)
        bot_file.save(bot['bot_file_path'])
        
        log_path = os.path.join(LOG_FOLDER, f'{bot_id}.log')
        with open(log_path, 'a') as f:
            f.write(f"\n{'='*60}\n")
            f.write(f"📤 Bot Code Updated at {datetime.now()}\n")
            f.write(f"New File: {filename}\n")
            f.write(f"{'='*60}\n\n")
            f.write(f"📦 Re-installing dependencies...\n")
        
        # Reset deps_installed and start new installation
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("UPDATE bots SET status = 'stopped', error_message = NULL, deps_installed = 0 WHERE bot_id = ? AND user_id = ?", 
                 (bot_id, user_id))
        conn.commit()
        conn.close()
        
        # Start new dependency installation
        thread = threading.Thread(target=auto_install_deps_with_status, args=(bot['bot_file_path'], log_path, bot_id))
        thread.daemon = True
        thread.start()
        
        Database.log_activity(user_id, None, 'update_bot', bot_id, f"Bot code updated: {filename}", None)
        
        return {"status": "updated", "message": "Bot code updated. Dependencies being reinstalled."}
    
    @staticmethod
    def get_bot_logs(bot_id, user_id=None):
        """Get bot logs from file"""
        bot = BotManager.get_bot(bot_id, user_id)
        if not bot:
            return "Bot not found"
        
        log_path = os.path.join(LOG_FOLDER, f'{bot_id}.log')
        if not os.path.exists(log_path):
            return "No logs yet. Start the bot to see logs."
        
        try:
            with open(log_path, 'r') as f:
                return f.read()
        except Exception as e:
            return f"Error reading logs: {str(e)}"

# ========== DATABASE HELPERS ==========
class Database:
    @staticmethod
    def create_user(username, password, email=None, is_admin=0):
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        try:
            c.execute("INSERT INTO users (username, password, email, is_admin) VALUES (?, ?, ?, ?)",
                     (username, password, email, is_admin))
            conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False
        finally:
            conn.close()
    
    @staticmethod
    def get_user(username):
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT id, username, password, is_admin FROM users WHERE username = ?", (username,))
        row = c.fetchone()
        conn.close()
        if row:
            return {'id': row[0], 'username': row[1], 'password': row[2], 'is_admin': row[3]}
        return None
    
    @staticmethod
    def get_user_by_id(user_id):
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT id, username, is_admin FROM users WHERE id = ?", (user_id,))
        row = c.fetchone()
        conn.close()
        if row:
            return {'id': row[0], 'username': row[1], 'is_admin': row[2]}
        return None
    
    @staticmethod
    def get_current_user():
        """Get current user from session"""
        if 'user_id' in session:
            return Database.get_user_by_id(session['user_id'])
        return None
    
    @staticmethod
    def update_last_login(user_id):
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?", (user_id,))
        conn.commit()
        conn.close()
    
    @staticmethod
    def log_activity(user_id, username, action, bot_id=None, details=None, ip_address=None, level='info'):
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("INSERT INTO activity_logs (user_id, username, action, bot_id, details, ip_address, level) VALUES (?, ?, ?, ?, ?, ?, ?)",
                 (user_id, username, action, bot_id, details, ip_address, level))
        conn.commit()
        conn.close()
    
    @staticmethod
    def get_all_users():
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT id, username, email, is_admin, created_at, last_login FROM users ORDER BY created_at DESC")
        rows = c.fetchall()
        conn.close()
        return [{'id': r[0], 'username': r[1], 'email': r[2], 'is_admin': r[3], 'created_at': r[4], 'last_login': r[5]} for r in rows]
    
    @staticmethod
    def get_all_bots():
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("""SELECT b.bot_id, b.bot_name, b.status, b.total_messages, b.created_at, u.username 
                     FROM bots b JOIN users u ON b.user_id = u.id ORDER BY b.created_at DESC""")
        rows = c.fetchall()
        conn.close()
        return [{'bot_id': r[0], 'bot_name': r[1], 'status': r[2], 'total_messages': r[3] or 0, 'created_at': r[4], 'username': r[5]} for r in rows]
    
    @staticmethod
    def get_activity_logs(limit=50, level=None):
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        if level and level != 'all':
            c.execute("SELECT username, action, bot_id, details, timestamp, level FROM activity_logs WHERE level = ? ORDER BY timestamp DESC LIMIT ?", (level, limit))
        else:
            c.execute("SELECT username, action, bot_id, details, timestamp, level FROM activity_logs ORDER BY timestamp DESC LIMIT ?", (limit,))
        rows = c.fetchall()
        conn.close()
        return [{'username': r[0], 'action': r[1], 'bot_id': r[2], 'details': r[3], 'timestamp': r[4], 'level': r[5] or 'info'} for r in rows]
    
    @staticmethod
    def get_stats():
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT COUNT(*) FROM users WHERE is_admin = 0")
        total_users = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM bots")
        total_bots = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM bots WHERE status = 'running'")
        active_bots = c.fetchone()[0]
        c.execute("SELECT SUM(total_messages) FROM bots")
        total_messages = c.fetchone()[0] or 0
        conn.close()
        return {'total_users': total_users, 'total_bots': total_bots, 'active_bots': active_bots, 'total_messages': total_messages}
    
    @staticmethod
    def get_trend_stats():
        """Calculate percentage changes for dashboard trends"""
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        
        # Get date ranges
        today = datetime.now().date()
        last_month = today - timedelta(days=30)
        last_week = today - timedelta(days=7)
        yesterday = today - timedelta(days=1)
        day_before_yesterday = today - timedelta(days=2)
        
        # Current totals
        c.execute("SELECT COUNT(*) FROM users WHERE is_admin = 0")
        total_users = c.fetchone()[0]
        
        c.execute("SELECT COUNT(*) FROM bots")
        total_bots = c.fetchone()[0]
        
        c.execute("SELECT COUNT(*) FROM bots WHERE status = 'running'")
        active_bots = c.fetchone()[0]
        
        c.execute("SELECT COALESCE(SUM(total_messages), 0) FROM bots")
        total_messages = c.fetchone()[0]
        
        # Users from last month
        c.execute("SELECT COUNT(*) FROM users WHERE is_admin = 0 AND created_at >= ?", (last_month,))
        users_last_month = c.fetchone()[0]
        
        # Bots from last week
        c.execute("SELECT COUNT(*) FROM bots WHERE created_at >= ?", (last_week,))
        bots_last_week = c.fetchone()[0]
        
        # Active bots from yesterday vs day before
        c.execute("SELECT COUNT(*) FROM bots WHERE status = 'running' AND created_at >= ?", (yesterday,))
        active_yesterday = c.fetchone()[0]
        
        c.execute("SELECT COUNT(*) FROM bots WHERE status = 'running' AND created_at >= ?", (day_before_yesterday,))
        active_day_before = c.fetchone()[0]
        
        # Messages from last week
        c.execute("SELECT COALESCE(SUM(total_messages), 0) FROM bots WHERE created_at >= ?", (last_week,))
        messages_last_week = c.fetchone()[0]
        
        conn.close()
        
        # Calculate percentages
        def calc_percentage(current, previous):
            if previous == 0:
                return 0 if current == 0 else 100
            return round(((current - previous) / previous) * 100, 1)
        
        # Users trend (month over month)
        users_previous_month = total_users - users_last_month
        users_trend = calc_percentage(users_last_month, users_previous_month)
        
        # Bots trend (week over week)
        bots_previous_week = total_bots - bots_last_week
        bots_trend = calc_percentage(bots_last_week, bots_previous_week)
        
        # Active bots trend (day over day)
        active_trend = calc_percentage(active_yesterday, active_day_before) if active_day_before > 0 else 0
        
        # Messages trend (week over week)
        messages_previous_week = total_messages - messages_last_week
        messages_trend = calc_percentage(messages_last_week, messages_previous_week)
        
        return {
            'users_trend': abs(users_trend),
            'users_trend_direction': 'up' if users_trend >= 0 else 'down',
            'users_trend_period': 'this month',
            'bots_trend': abs(bots_trend),
            'bots_trend_direction': 'up' if bots_trend >= 0 else 'down',
            'bots_trend_period': 'this week',
            'active_trend': abs(active_trend),
            'active_trend_direction': 'up' if active_trend >= 0 else 'down',
            'active_trend_period': 'vs yesterday',
            'messages_trend': abs(messages_trend),
            'messages_trend_direction': 'up' if messages_trend >= 0 else 'down',
            'messages_trend_period': 'this week'
        }
    
    @staticmethod
    def delete_user(user_id):
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
        conn.close()

# ========== AUTH DECORATORS ==========
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Unauthorized'}), 401
        user = Database.get_user_by_id(session['user_id'])
        if not user or not user.get('is_admin'):
            return jsonify({'error': 'Admin access required'}), 403
        return f(*args, **kwargs)
    return decorated

# ========== SPA ROUTES ==========
@app.route('/')
def index():
    if 'user_id' in session:
        user = Database.get_user_by_id(session['user_id'])
        if user and user.get('is_admin'):
            # Serve SPA with admin context
            return render_template('spa.html', initial_path='/admin')
        return render_template('spa.html', initial_path='/dashboard')
    return render_template('spa.html', initial_path='/login')

# Serve the JavaScript SPA file
@app.route('/app.js')
def serve_spa_js():
    return send_from_directory(STATIC_FOLDER, 'app.js')

# ========== LEGACY ROUTES (for backward compatibility) ==========
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        user = Database.get_user(username)
        if user and bcrypt.checkpw(password.encode('utf-8'), user['password'].encode('utf-8')):
            session['user_id'] = user['id']
            session['username'] = user['username']
            session['is_admin'] = user['is_admin']
            Database.update_last_login(user['id'])
            Database.log_activity(user['id'], username, 'login', ip_address=request.remote_addr, level='info')
            
            if user['is_admin']:
                return redirect(url_for('admin_dashboard'))
            return redirect(url_for('dashboard'))
        else:
            return render_template('login.html', error="Invalid username or password")
    
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        email = request.form.get('email')
        
        if not username or not password:
            return render_template('register.html', error="Username and password required")
        
        hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())
        
        if Database.create_user(username, hashed.decode('utf-8'), email):
            Database.log_activity(None, username, 'register', ip_address=request.remote_addr, level='info')
            return redirect(url_for('login'))
        else:
            return render_template('register.html', error="Username already exists")
    
    return render_template('register.html')

@app.route('/logout')
def logout():
    if 'user_id' in session:
        Database.log_activity(session['user_id'], session['username'], 'logout', ip_address=request.remote_addr, level='info')
    session.clear()
    return redirect(url_for('login'))

@app.route('/dashboard')
@login_required
def dashboard():
    if session.get('is_admin'):
        return redirect(url_for('admin_dashboard'))
    bots = BotManager.list_bots(session['user_id'])
    return render_template('dashboard.html', username=session['username'], bots=bots)

@app.route('/bot_console/<bot_id>')
@login_required
def bot_console(bot_id):
    bot = BotManager.get_bot(bot_id, session['user_id'])
    if not bot:
        return redirect(url_for('dashboard'))
    return render_template('bot_console.html', bot=bot)

# ========== ADMIN ROUTES ==========
@app.route('/admin')
@admin_required
def admin_dashboard():
    stats = Database.get_stats()
    trends = Database.get_trend_stats()
    users = Database.get_all_users()
    bots = Database.get_all_bots()
    logs = Database.get_activity_logs(30)
    my_bots = BotManager.list_bots(session['user_id'])
    
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    for user in users:
        c.execute("SELECT COUNT(*) FROM bots WHERE user_id = ?", (user['id'],))
        user['bots_count'] = c.fetchone()[0]
    conn.close()
    
    return render_template('admin_dashboard.html', 
                         username=session['username'], 
                         stats=stats, 
                         trends=trends,
                         users=users, 
                         bots=bots, 
                         logs=logs, 
                         my_bots=my_bots)

@app.route('/admin/settings')
@admin_required
def admin_settings():
    return render_template('admin_settings.html', username=session['username'])

@app.route('/admin/create_bot', methods=['POST'])
@admin_required
def admin_create_bot():
    user_id = request.form.get('user_id')
    bot_token = request.form.get('bot_token')
    bot_name = request.form.get('bot_name')
    bot_file = request.files.get('bot_file')
    
    if not all([user_id, bot_token, bot_name, bot_file]):
        return jsonify({'error': 'All fields required'}), 400
    
    try:
        bot = BotManager.register_bot(int(user_id), bot_token, bot_name, bot_file)
        Database.log_activity(session['user_id'], session['username'], 'admin_create_bot', bot['bot_id'], f"Created for user_id: {user_id}", request.remote_addr, level='info')
        return jsonify(bot), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

@app.route('/admin/users')
@admin_required
def admin_users():
    users = Database.get_all_users()
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    for user in users:
        c.execute("SELECT COUNT(*) FROM bots WHERE user_id = ?", (user['id'],))
        user['bots_count'] = c.fetchone()[0]
    conn.close()
    return render_template('admin_users.html', users=users, username=session['username'])

@app.route('/admin/bots')
@admin_required
def admin_bots():
    bots = Database.get_all_bots()
    return render_template('admin_bots.html', bots=bots, username=session['username'])

@app.route('/admin/logs')
@admin_required
def admin_logs():
    level = request.args.get('level', 'all')
    logs = Database.get_activity_logs(200, level)
    return render_template('admin_logs.html', logs=logs, username=session['username'])

@app.route('/admin/health', methods=['GET'])
@admin_required
def system_health():
    """Get system health metrics"""
    try:
        # CPU usage
        cpu_percent = psutil.cpu_percent(interval=1)
        
        # Memory usage
        memory = psutil.virtual_memory()
        memory_used_mb = memory.used / (1024 * 1024)
        memory_total_mb = memory.total / (1024 * 1024)
        
        # Disk usage
        disk = psutil.disk_usage('/')
        disk_used_gb = disk.used / (1024 * 1024 * 1024)
        disk_total_gb = disk.total / (1024 * 1024 * 1024)
        
        # Uptime
        boot_time = datetime.fromtimestamp(psutil.boot_time())
        uptime = datetime.now() - boot_time
        uptime_str = f"{uptime.days}d {uptime.seconds // 3600}h {(uptime.seconds % 3600) // 60}m"
        
        # Active bots count
        active_bots = len(running_bots)
        
        # Bot stats
        total_bot_runtime = 0
        for bot_id, start_time in bot_start_times.items():
            runtime = (datetime.now() - start_time).total_seconds()
            total_bot_runtime += runtime
        
        return jsonify({
            'cpu': round(cpu_percent, 1),
            'memory': round(memory_used_mb, 1),
            'memory_total': round(memory_total_mb, 1),
            'memory_percent': round(memory.percent, 1),
            'disk': round(disk_used_gb, 1),
            'disk_total': round(disk_total_gb, 1),
            'disk_percent': round(disk.percent, 1),
            'uptime': uptime_str,
            'active_bots': active_bots,
            'total_bot_runtime': round(total_bot_runtime / 3600, 1),
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        logger.error(f"Health check error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/admin/export/data', methods=['GET'])
@admin_required
def export_data():
    """Export platform data as JSON"""
    try:
        export_data = {
            'exported_at': datetime.now().isoformat(),
            'stats': Database.get_stats(),
            'users': Database.get_all_users(),
            'bots': Database.get_all_bots(),
            'logs': Database.get_activity_logs(500)
        }
        
        # Add bot counts per user
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        for user in export_data['users']:
            c.execute("SELECT COUNT(*) FROM bots WHERE user_id = ?", (user['id'],))
            user['bot_count'] = c.fetchone()[0]
        conn.close()
        
        # Create temporary file
        export_file = os.path.join(LOG_FOLDER, f'export_{int(time.time())}.json')
        with open(export_file, 'w') as f:
            json.dump(export_data, f, indent=2, default=str)
        
        # Send file
        return send_file(export_file, as_attachment=True, download_name=f'bothost_export_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json')
        
    except Exception as e:
        logger.error(f"Export error: {e}")
        return jsonify({'error': str(e)}), 500

# ========== API ENDPOINTS ==========

# User API
@app.route('/api/user', methods=['GET'])
@login_required
def api_get_user():
    """Get current user info"""
    user = Database.get_user_by_id(session['user_id'])
    if not user:
        return jsonify({'error': 'User not found'}), 404
    return jsonify({
        'id': user['id'],
        'username': user['username'],
        'is_admin': user['is_admin']
    })

@app.route('/api/admin/stats', methods=['GET'])
@admin_required
def api_admin_stats():
    """Get real-time stats for auto-refresh"""
    try:
        stats = Database.get_stats()
        
        # Add real-time running bots count
        stats['active_bots'] = len(running_bots)
        
        # Add today's new users
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT COUNT(*) FROM users WHERE DATE(created_at) = DATE('now') AND is_admin = 0")
        stats['new_users_today'] = c.fetchone()[0]
        
        # Add today's new bots
        c.execute("SELECT COUNT(*) FROM bots WHERE DATE(created_at) = DATE('now')")
        stats['new_bots_today'] = c.fetchone()[0]
        
        conn.close()
        
        return jsonify(stats)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/admin/trends', methods=['GET'])
@admin_required
def api_trends():
    """Get trend statistics for dashboard"""
    try:
        trends = Database.get_trend_stats()
        return jsonify(trends)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/my/bots', methods=['GET'])
@login_required
def api_my_bots():
    """Get current user's bots with real-time status"""
    bots = BotManager.list_bots(session['user_id'])
    
    # Add real-time status
    for bot in bots:
        if bot['bot_id'] in running_bots:
            bot['status'] = 'running'
            # Add runtime if running
            if bot['bot_id'] in bot_start_times:
                runtime = (datetime.now() - bot_start_times[bot['bot_id']]).total_seconds()
                bot['runtime'] = round(runtime / 60, 1)
    
    return jsonify({'bots': bots})

@app.route('/admin/user/<int:user_id>/delete', methods=['POST'])
@admin_required
def admin_delete_user(user_id):
    if user_id == session['user_id']:
        return jsonify({'error': 'Cannot delete your own account'}), 400
    
    # Delete all user's bots first
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT bot_id FROM bots WHERE user_id = ?", (user_id,))
    for row in c.fetchall():
        BotManager.delete_bot(row[0])
    
    # Delete user
    Database.delete_user(user_id)
    conn.close()
    
    Database.log_activity(session['user_id'], session['username'], 'admin_delete_user', None, f"Deleted user_id: {user_id}", request.remote_addr, level='warning')
    return jsonify({'success': True})

@app.route('/admin/bot/<bot_id>/delete', methods=['POST'])
@admin_required
def admin_delete_bot(bot_id):
    BotManager.delete_bot(bot_id)
    Database.log_activity(session['user_id'], session['username'], 'admin_delete_bot', bot_id, None, request.remote_addr, level='warning')
    return jsonify({'success': True})

@app.route('/admin/bot/<bot_id>/start', methods=['POST'])
@admin_required
def admin_start_bot(bot_id):
    result = BotManager.start_bot(bot_id)
    Database.log_activity(session['user_id'], session['username'], 'admin_start_bot', bot_id, None, request.remote_addr, level='info')
    return jsonify(result)

@app.route('/admin/bot/<bot_id>/stop', methods=['POST'])
@admin_required
def admin_stop_bot(bot_id):
    result = BotManager.stop_bot(bot_id)
    Database.log_activity(session['user_id'], session['username'], 'admin_stop_bot', bot_id, None, request.remote_addr, level='info')
    return jsonify(result)

@app.route('/admin/bot/<bot_id>/restart', methods=['POST'])
@admin_required
def admin_restart_bot(bot_id):
    result = BotManager.restart_bot(bot_id)
    Database.log_activity(session['user_id'], session['username'], 'admin_restart_bot', bot_id, None, request.remote_addr, level='info')
    return jsonify(result)

# ========== BOT API ENDPOINTS ==========
@app.route('/api/bots', methods=['GET'])
@login_required
def api_list_bots():
    return jsonify(BotManager.list_bots(session['user_id']))

@app.route('/api/bots', methods=['POST'])
@login_required
def api_create_bot():
    bot_token = request.form.get('bot_token')
    bot_name = request.form.get('bot_name')
    bot_file = request.files.get('bot_file')
    
    if not bot_token or not bot_name:
        return jsonify({'error': 'Bot token and name required'}), 400
    if not bot_file:
        return jsonify({'error': 'Python file required'}), 400
    
    # Validate token format
    if not re.match(r'^\d+:[a-zA-Z0-9_-]+$', bot_token):
        return jsonify({'error': 'Invalid bot token format'}), 400
    
    try:
        bot = BotManager.register_bot(session['user_id'], bot_token, bot_name, bot_file)
        Database.log_activity(session['user_id'], session['username'], 'create_bot', bot['bot_id'], None, request.remote_addr, level='info')
        return jsonify(bot), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/bots/<bot_id>/info', methods=['GET'])
@login_required
def api_bot_info(bot_id):
    """Get bot info for console"""
    bot = BotManager.get_bot_info(bot_id, session['user_id'])
    if not bot:
        return jsonify({'error': 'Bot not found'}), 404
    return jsonify(bot)

@app.route('/api/bots/<bot_id>', methods=['DELETE'])
@login_required
def api_delete_bot(bot_id):
    result = BotManager.delete_bot(bot_id, session['user_id'])
    Database.log_activity(session['user_id'], session['username'], 'delete_bot', bot_id, None, request.remote_addr, level='warning')
    return jsonify({'success': result})

@app.route('/api/bots/<bot_id>/start', methods=['POST'])
@login_required
def api_start_bot(bot_id):
    result = BotManager.start_bot(bot_id, session['user_id'])
    Database.log_activity(session['user_id'], session['username'], 'start_bot', bot_id, None, request.remote_addr, level='info')
    return jsonify(result)

@app.route('/api/bots/<bot_id>/stop', methods=['POST'])
@login_required
def api_stop_bot(bot_id):
    result = BotManager.stop_bot(bot_id, session['user_id'])
    Database.log_activity(session['user_id'], session['username'], 'stop_bot', bot_id, None, request.remote_addr, level='info')
    return jsonify(result)

@app.route('/api/bots/<bot_id>/restart', methods=['POST'])
@login_required
def api_restart_bot(bot_id):
    result = BotManager.restart_bot(bot_id, session['user_id'])
    Database.log_activity(session['user_id'], session['username'], 'restart_bot', bot_id, None, request.remote_addr, level='info')
    return jsonify(result)

@app.route('/api/bots/<bot_id>/logs', methods=['GET'])
@login_required
def api_bot_logs(bot_id):
    """Get bot logs - returns full log content"""
    bot = BotManager.get_bot(bot_id, session['user_id'])
    if not bot:
        return jsonify({'error': 'Bot not found', 'logs': ''}), 404
    
    log_path = os.path.join(LOG_FOLDER, f'{bot_id}.log')
    is_running = bot_id in running_bots
    
    if not os.path.exists(log_path):
        return jsonify({
            'logs': '',
            'status': 'running' if is_running else 'stopped'
        })
    
    try:
        with open(log_path, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
        
        return jsonify({
            'logs': content,
            'status': 'running' if is_running else 'stopped'
        })
    except Exception as e:
        return jsonify({'logs': '', 'status': 'stopped'}), 500

@app.route('/api/bots/<bot_id>/deps_status', methods=['GET'])
@login_required
def api_deps_status(bot_id):
    """Check if dependencies are installed"""
    bot = BotManager.get_bot(bot_id, session['user_id'])
    if not bot:
        return jsonify({'error': 'Bot not found'}), 404
    
    deps_installed = bot.get('deps_installed', 0) == 1
    
    return jsonify({
        'deps_installed': deps_installed,
        'bot_id': bot_id,
        'bot_name': bot['bot_name']
    })

@app.route('/api/bots/<bot_id>/upload', methods=['POST'])
@login_required
def api_upload_bot_file(bot_id):
    bot_file = request.files.get('bot_file')
    if not bot_file:
        return jsonify({'error': 'No file provided'}), 400
    
    result = BotManager.update_bot_file(bot_id, session['user_id'], bot_file)
    if result.get('status') == 'updated':
        Database.log_activity(session['user_id'], session['username'], 'upload_bot', bot_id, 'Updated bot code', request.remote_addr, level='info')
    return jsonify(result)

# ========== FILE MANAGEMENT API ==========
@app.route('/api/bots/<bot_id>/files', methods=['GET'])
@login_required
def api_list_files(bot_id):
    bot_dir = get_bot_directory(bot_id, session['user_id'])
    if not bot_dir:
        return jsonify({'error': 'Bot not found'}), 404
    
    rel_path = request.args.get('path', '')
    current_dir = get_relative_path(bot_dir, rel_path)
    
    if not os.path.exists(current_dir):
        return jsonify({'error': 'Directory not found'}), 404
    
    try:
        items = []
        for item in os.listdir(current_dir):
            # Skip __pycache__ and .pyc files
            if item == '__pycache__' or item.endswith('.pyc'):
                continue
                
            item_path = os.path.join(current_dir, item)
            is_dir = os.path.isdir(item_path)
            rel_item_path = os.path.relpath(item_path, bot_dir)
            
            items.append({
                'name': item,
                'path': rel_item_path,
                'is_dir': is_dir,
                'size': os.path.getsize(item_path) if not is_dir else 0,
                'size_text': format_file_size(os.path.getsize(item_path)) if not is_dir else '',
            })
        
        items.sort(key=lambda x: (not x['is_dir'], x['name'].lower()))
        
        parts = rel_path.split('/') if rel_path else []
        breadcrumb = []
        current = ''
        for part in parts:
            current = current + '/' + part if current else part
            breadcrumb.append({'name': part, 'path': current})
        
        parent_path = '/'.join(parts[:-1]) if parts else None
        
        return jsonify({
            'files': items,
            'current_path': rel_path,
            'parent_path': parent_path,
            'breadcrumb': breadcrumb
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/bots/<bot_id>/file', methods=['GET'])
@login_required
def api_get_file(bot_id):
    bot_dir = get_bot_directory(bot_id, session['user_id'])
    if not bot_dir:
        return jsonify({'error': 'Bot not found'}), 404
    
    file_path = request.args.get('path', '')
    abs_path = get_relative_path(bot_dir, file_path)
    
    if not os.path.exists(abs_path):
        return jsonify({'error': 'File not found'}), 404
    
    if os.path.isdir(abs_path):
        return jsonify({'error': 'Cannot read directory'}), 400
    
    try:
        with open(abs_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        return jsonify({'content': content, 'path': file_path})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/bots/<bot_id>/file', methods=['PUT'])
@login_required
def api_save_file(bot_id):
    bot_dir = get_bot_directory(bot_id, session['user_id'])
    if not bot_dir:
        return jsonify({'error': 'Bot not found'}), 404
    
    data = request.json
    file_path = data.get('path', '')
    content = data.get('content', '')
    
    abs_path = get_relative_path(bot_dir, file_path)
    
    try:
        with open(abs_path, 'w', encoding='utf-8') as f:
            f.write(content)
        Database.log_activity(session['user_id'], session['username'], 'edit_file', bot_id, f"Edited: {file_path}", request.remote_addr, level='info')
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/bots/<bot_id>/file', methods=['DELETE'])
@login_required
def api_delete_file(bot_id):
    bot_dir = get_bot_directory(bot_id, session['user_id'])
    if not bot_dir:
        return jsonify({'error': 'Bot not found'}), 404
    
    file_path = request.args.get('path', '')
    abs_path = get_relative_path(bot_dir, file_path)
    
    if not os.path.exists(abs_path):
        return jsonify({'error': 'File not found'}), 404
    
    try:
        if os.path.isdir(abs_path):
            shutil.rmtree(abs_path)
        else:
            os.remove(abs_path)
        Database.log_activity(session['user_id'], session['username'], 'delete_file', bot_id, f"Deleted: {file_path}", request.remote_addr, level='warning')
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/bots/<bot_id>/file', methods=['POST'])
@login_required
def api_create_file(bot_id):
    bot_dir = get_bot_directory(bot_id, session['user_id'])
    if not bot_dir:
        return jsonify({'error': 'Bot not found'}), 404
    
    data = request.json
    file_path = data.get('path', '')
    content = data.get('content', '# New file created\n\n')
    
    abs_path = get_relative_path(bot_dir, file_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    
    try:
        with open(abs_path, 'w', encoding='utf-8') as f:
            f.write(content)
        Database.log_activity(session['user_id'], session['username'], 'create_file', bot_id, f"Created: {file_path}", request.remote_addr, level='info')
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ========== UPLOAD ANY FILE TYPE WITH AUTO-RESTART ==========
@app.route('/api/bots/<bot_id>/upload_file', methods=['POST'])
@login_required
def api_upload_any_file(bot_id):
    """Upload any file type to bot directory with auto-restart for main bot file"""
    bot_dir = get_bot_directory(bot_id, session['user_id'])
    if not bot_dir:
        return jsonify({'error': 'Bot not found'}), 404
    
    file_path = request.form.get('path', '')
    uploaded_file = request.files.get('file')
    
    if not uploaded_file:
        return jsonify({'error': 'No file provided'}), 400
    
    # Check file size (50MB max)
    uploaded_file.seek(0, os.SEEK_END)
    file_size = uploaded_file.tell()
    uploaded_file.seek(0)
    
    if file_size > 50 * 1024 * 1024:
        return jsonify({'error': 'File too large. Max 50MB'}), 400
    
    # Sanitize filename
    filename = secure_filename(uploaded_file.filename)
    if not filename:
        return jsonify({'error': 'Invalid filename'}), 400
    
    # Build the full path
    if file_path:
        full_path = os.path.join(bot_dir, file_path)
        target_dir = os.path.dirname(full_path)
    else:
        full_path = os.path.join(bot_dir, filename)
        target_dir = bot_dir
    
    # Create directory if it doesn't exist
    os.makedirs(target_dir, exist_ok=True)
    
    # Check if this is the main bot file
    bot = BotManager.get_bot(bot_id, session['user_id'])
    is_main_bot_file = bot and bot['bot_file_path'] == full_path
    
    try:
        uploaded_file.save(full_path)
        Database.log_activity(session['user_id'], session['username'], 'upload_file', bot_id, 
                            f"Uploaded: {file_path if file_path else filename}", request.remote_addr, level='info')
        
        # Auto-restart if this is the main bot file
        auto_restarted = False
        restart_status = None
        
        if is_main_bot_file:
            add_console_log(bot_id, f"📤 Main bot file '{filename}' uploaded. Auto-restarting...")
            restart_result = BotManager.safe_restart_bot(bot_id, session['user_id'])
            auto_restarted = True
            restart_status = restart_result
            
            if restart_result.get('status') == 'restarted':
                add_console_log(bot_id, f"✅ Bot restarted successfully with new code!")
            else:
                add_console_log(bot_id, f"⚠️ Bot file updated but restart failed: {restart_result.get('error', 'Unknown error')}")
        
        return jsonify({
            'success': True, 
            'path': file_path if file_path else filename, 
            'filename': filename,
            'auto_restarted': auto_restarted,
            'restart_status': restart_status,
            'is_main_file': is_main_bot_file
        })
    except Exception as e:
        logger.error(f"File upload error: {e}")
        return jsonify({'error': str(e)}), 500

# ========== DOWNLOAD FILE ==========
@app.route('/api/bots/<bot_id>/download', methods=['GET'])
@login_required
def api_download_file(bot_id):
    """Download a file from bot directory"""
    bot_dir = get_bot_directory(bot_id, session['user_id'])
    if not bot_dir:
        return jsonify({'error': 'Bot not found'}), 404
    
    file_path = request.args.get('path', '')
    abs_path = get_relative_path(bot_dir, file_path)
    
    if not os.path.exists(abs_path):
        return jsonify({'error': 'File not found'}), 404
    
    if os.path.isdir(abs_path):
        return jsonify({'error': 'Cannot download directory'}), 400
    
    try:
        return send_file(abs_path, as_attachment=True, download_name=os.path.basename(abs_path))
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ========== HELPER FUNCTION FOR CONSOLE LOGS ==========
def add_console_log(bot_id, message):
    """Add a message to the bot's console log"""
    log_path = os.path.join(LOG_FOLDER, f'{bot_id}.log')
    try:
        with open(log_path, 'a') as f:
            f.write(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 🔄 {message}\n")
    except Exception as e:
        logger.error(f"Failed to write console log: {e}")

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)