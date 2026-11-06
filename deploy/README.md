# Deploying Outbreak

The game is a static site: HTML, JavaScript, one character model and four skin textures. It runs
entirely in the player's browser, so there is no backend to run. A server would not make it
smoother; it only matters once there are accounts, saved progress, leaderboards or multiplayer.

What makes it load fast is how the files are served: compressed, and cached so a second visit
downloads almost nothing. `nginx.conf` here does that.

Nothing has been deployed. These are the steps for when you choose to.

## On your machine

```sh
npm ci            # exact versions from the lockfile; install scripts are disabled by .npmrc
npm test
npm run build     # writes dist/
rsync -avz --delete dist/ USER@SERVER:/var/www/outbreak/
```

## On the server (once)

```sh
sudo apt install nginx            # or your distribution's equivalent
sudo mkdir -p /var/www/outbreak && sudo chown "$USER" /var/www/outbreak
sudo cp nginx.conf /etc/nginx/conf.d/outbreak.conf   # edit server_name first
sudo nginx -t && sudo systemctl reload nginx
```

Open port 80 (and 443) in the Lighthouse firewall panel. For HTTPS, which phones increasingly
expect, use certbot: `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d your.domain`.

## What the config does

| Files | Cache | Why |
|---|---|---|
| `index.html` | always revalidate | so a new build is seen immediately |
| `/assets/*` (built JS, CSS) | 1 year, immutable | names change whenever content changes |
| `/assets/characters/*` | 1 day | model and skins keep their names between builds |

Everything is gzip-compressed (about 208 KB of JavaScript and about 430 KB of character data
over the wire on the first visit; a few KB after that).
