#!/usr/bin/env python3
"""
ARIS PC Status Reporter
Envoie un heartbeat au serveur pour indiquer que le PC est allumé.
Compatible Windows et Linux.
"""

import socket
import platform
import urllib.request
import time
import os
import sys
import hashlib
import json

VERSION = "1.0.0"
SERVER_URL = "https://localhost:3000"
INTERVAL = 30

def get_device_id():
    """Génère un ID unique pour cette machine."""
    info = f"{platform.node()}-{platform.machine()}-{platform.processor()}"
    return hashlib.md5(info.encode()).hexdigest()[:16]

def get_config_file():
    """Retourne le chemin du fichier de config."""
    if sys.platform == 'win32':
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')
    return os.path.join(os.path.expanduser('~/.aris-reporter'), 'config.json')

def get_pc_info():
    """Récupère les informations de la machine."""
    return {
        "hostname": socket.gethostname(),
        "os": platform.system(),
        "device_id": get_device_id()
    }

def load_config():
    """Charge la configuration."""
    config_file = get_config_file()
    if os.path.exists(config_file):
        try:
            with open(config_file, 'r') as f:
                return json.load(f)
        except:
            pass
    return None

def save_config(badge_code):
    """Sauvegarde la configuration."""
    config_file = get_config_file()
    os.makedirs(os.path.dirname(config_file), exist_ok=True)
    config = {
        "badge_code": badge_code,
        "device_id": get_device_id()
    }
    with open(config_file, 'w') as f:
        json.dump(config, f, indent=2)
    print(f"Configuration sauvegardee: {config_file}")

def get_badge_from_config():
    """Demande le code badge et sauvegarde."""
    print("=" * 40)
    print("  ARIS PC Status Reporter - Configuration")
    print("=" * 40)
    print()
    badge = input("Entrez votre numero de badge (ex: 8): ").strip()
    
    if not badge:
        print("Erreur: Numero de badge requis!")
        sys.exit(1)
    
    save_config(badge)
    return badge

def send_heartbeat(badge_code):
    """Envoie un heartbeat au serveur."""
    device_id = get_device_id()
    hostname = socket.gethostname()
    
    url = f"{SERVER_URL}/api/pc-status/heartbeat"
    data = f"badge_code={badge_code}&device_id={device_id}&hostname={hostname}".encode('utf-8')
    
    try:
        import ssl
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        
        req = urllib.request.Request(url, data=data, method='POST')
        req.add_header('Content-Type', 'application/x-www-form-urlencoded')
        req.add_header('User-Agent', f'ARIS-PC-Reporter/{VERSION}')
        
        with urllib.request.urlopen(req, context=context, timeout=10) as response:
            return True
    except Exception:
        return False

def main():
    # Charger ou demander la configuration
    config = load_config()
    
    if not config or not config.get('badge_code'):
        badge_code = get_badge_from_config()
    else:
        badge_code = config['badge_code']
    
    pc_info = get_pc_info()
    
    print()
    print("=" * 40)
    print("  ARIS PC Status Reporter - Actif")
    print("=" * 40)
    print(f"Machine: {pc_info['hostname']}")
    print(f"Badge: {badge_code}")
    print(f"Server: {SERVER_URL}")
    print("-" * 40)
    print()
    
    while True:
        success = send_heartbeat(badge_code)
        
        if success:
            print(f"[{time.strftime('%H:%M:%S')}] PC actif - {pc_info['hostname']}")
        else:
            print(f"[{time.strftime('%H:%M:%S')}] Erreur de connexion")
        
        time.sleep(INTERVAL)

if __name__ == '__main__':
    main()
