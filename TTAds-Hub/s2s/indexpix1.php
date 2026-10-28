<?php
/**
 * TTAds Hub · S2S: постбэк Keitaro → TikTok Events API.
 *
 * Совместим с исходным S2S_TTAds: те же параметры pix / at / ttclid / event / user_agent / ip / value.
 * Дополнительно: api=2 (Events API 2.0), currency, test (test_event_code), event_id и dry=1
 * (показать, что было бы отправлено, не обращаясь к TikTok — удобно для проверки ссылки постбэка).
 * Убрана проверка IP через ipify: при недоступности ipify событие раньше не отправлялось вовсе.
 *
 * Важно: Access Token передаётся в URL (так устроены постбэки Keitaro) и попадает в логи веб-сервера и трекера —
 * ограничьте доступ к этим логам. В ответе поле "ok" = true, только если TikTok вернул code 0.
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function respond(int $status, array $body): void
{
    http_response_code($status);
    $json = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR);
    echo $json === false ? '{"error":"Response encoding failed"}' : $json;
    exit;
}

function param(string $name, string $default = ''): string
{
    $value = $_GET[$name] ?? $default;
    return is_string($value) ? trim($value) : $default;
}

// Неподставленный макрос Keitaro вида {ttclid} считаем пустым значением.
function clean(string $value): string
{
    return preg_match('/^\{[A-Za-z0-9_]+\}$/', $value) ? '' : $value;
}

$pixel    = param('pix');
$token    = param('at');
$event    = param('event');
$ttclid   = clean(param('ttclid'));
$userAgent = clean(param('user_agent'));
$ip       = clean(param('ip'));
$value    = clean(param('value'));
$currency = strtoupper(param('currency', 'USD'));
$api      = param('api', '1') === '2' ? '2' : '1';
$testCode = param('test');
$eventId  = param('event_id');
$dryRun   = param('dry') === '1';

if ($pixel === '' || $token === '' || $event === '') {
    respond(400, ['error' => 'Missing required parameters: pix, at, event']);
}
if (!preg_match('/^[A-Za-z0-9_-]{6,64}$/', $pixel)) {
    respond(400, ['error' => 'Invalid pix']);
}
if (!preg_match('/^\S{16,512}$/', $token)) {
    respond(400, ['error' => 'Invalid at']);
}
if (!preg_match('/^[A-Za-z0-9_]{1,64}$/', $event)) {
    respond(400, ['error' => 'Invalid event']);
}
if (!preg_match('/^[A-Z]{3}$/', $currency)) {
    $currency = 'USD';
}

$properties = null;
if ($value !== '' && is_numeric($value)) {
    $number = (float) $value;
    if (is_finite($number) && abs($number) < 1e12) {
        $properties = ['currency' => $currency, 'value' => $number];
    }
}

if ($api === '2') {
    // Events API 2.0: единый эндпоинт /event/track/, время события — Unix-секунды.
    $url = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';
    $user = [];
    if ($ttclid !== '')    { $user['ttclid'] = $ttclid; }
    if ($ip !== '')        { $user['ip'] = $ip; }
    if ($userAgent !== '') { $user['user_agent'] = $userAgent; }
    $item = ['event' => $event, 'event_time' => time(), 'user' => (object) $user];
    if ($eventId !== '')    { $item['event_id'] = $eventId; }
    if ($properties !== null) { $item['properties'] = $properties; }
    $payload = ['event_source' => 'web', 'event_source_id' => $pixel, 'data' => [$item]];
    if ($testCode !== '') { $payload['test_event_code'] = $testCode; }
} else {
    // Events API 1.0: /pixel/track/ — как в исходном скрипте (без page.url).
    $url = 'https://business-api.tiktok.com/open_api/v1.3/pixel/track/';
    $context = [];
    if ($ip !== '')        { $context['ip'] = $ip; }
    if ($userAgent !== '') { $context['user_agent'] = $userAgent; }
    if ($ttclid !== '')    { $context['ad'] = ['callback' => $ttclid]; }
    $payload = [
        'pixel_code' => $pixel,
        'event'      => $event,
        'timestamp'  => gmdate('Y-m-d\TH:i:s\Z'),
        'context'    => (object) $context,
    ];
    if ($eventId !== '')    { $payload['event_id'] = $eventId; }
    if ($properties !== null) { $payload['properties'] = $properties; }
}

$body = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
if ($body === false) {
    respond(400, ['error' => 'Payload encoding failed']);
}

if ($dryRun) {
    respond(200, ['ok' => null, 'dry_run' => true, 'api' => $api, 'endpoint' => $url, 'sent_payload' => $payload]);
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'Access-Token: ' . $token],
    CURLOPT_POSTFIELDS     => $body,
]);
$response = curl_exec($ch);
$httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($response === false) {
    respond(502, ['api' => $api, 'error' => 'TikTok unreachable: ' . $curlError, 'sent_payload' => $payload]);
}

$decoded = json_decode((string) $response, true);
respond($httpCode === 200 ? 200 : 502, [
    'ok'              => $httpCode === 200 && is_array($decoded) && ($decoded['code'] ?? null) === 0,
    'api'             => $api,
    'sent_payload'    => $payload,
    'tiktok_response' => $httpCode === 200 ? $decoded : ['error' => 'Failed to send event', 'http' => $httpCode, 'response' => $decoded ?? $response],
]);
