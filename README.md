# 🏠 БУНКЕР — Онлайн игра

## Запуск локально

### 1. Сервер (бэкенд)
```bash
cd server
npm install
npm run dev
# Сервер запустится на http://localhost:3001
```

### 2. Фронтенд
```bash
# В корне проекта
npm install
npm run dev
# Откройте http://localhost:5173
```

## Деплой

### Бэкенд → Render.com (бесплатно)
1. Зайдите на render.com
2. New → Web Service → подключите GitHub репозиторий
3. Root Directory: `server`
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Добавьте переменную окружения:
   - `MONGODB_URI` = ваш MongoDB Atlas URI (опционально)
7. Скопируйте URL сервера (например `https://bunker-xxx.onrender.com`)

### Фронтенд → Vercel (бесплатно)
1. Зайдите на vercel.com
2. New Project → подключите GitHub репозиторий
3. Root Directory: `.` (корень)
4. Добавьте переменную окружения:
   - `VITE_SERVER_URL` = URL вашего Render сервера
5. Deploy!

## Как играть
- Создайте комнату → поделитесь кодом с друзьями
- Каждый заходит со своего телефона/компьютера
- Нажмите "Раскрыть" у карточки — все сразу увидят
- После раунда — событие → голосование
- В конце — расчёт выживания
