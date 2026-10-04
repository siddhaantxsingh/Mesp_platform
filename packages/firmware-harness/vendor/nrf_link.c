#include "nrf_link.h"
#include "app_config.h"
#include "console.h"
#include <string.h>

#define NRF_RING_MASK    (NRF_TX_RING_SIZE - 1u)
#define NRF_FRAME_MAX    (9u + 1008u)   /* header + max payload + crc */

static UART_HandleTypeDef *nrf_uart;
static uint8_t             nrf_tx_ring[NRF_TX_RING_SIZE];
static volatile uint16_t   nrf_head;     /* producer (main) */
static volatile uint16_t   nrf_tail;     /* consumer (DMA ISR) */
static volatile uint8_t    nrf_tx_active;
static uint16_t            nrf_tx_len;
static uint8_t             nrf_seq;
static uint32_t            nrf_tx_dropped;
static volatile uint32_t   nrf_rx_events;

static uint8_t  nrf_rx_buf[NRF_RX_BUF_SIZE];
static uint8_t  nrf_frame[NRF_FRAME_MAX];
static uint8_t  nrf_payload[1008];

static uint16_t crc16_ccitt(const uint8_t *data, uint16_t len)
{
    uint16_t crc = 0xFFFFu;
    uint16_t i;
    uint8_t  b;
    for (i = 0u; i < len; i++) {
        crc ^= (uint16_t)data[i] << 8;
        for (b = 0u; b < 8u; b++) {
            if (crc & 0x8000u) crc = (uint16_t)((crc << 1) ^ 0x1021u);
            else               crc = (uint16_t)(crc << 1);
        }
    }
    return crc;
}

static uint16_t ring_free(void)
{
    return (uint16_t)((NRF_TX_RING_SIZE - 1u) - ((nrf_head - nrf_tail) & NRF_RING_MASK));
}

static uint8_t ring_write(const uint8_t *data, uint16_t len)
{
    uint16_t i;
    if (ring_free() < len) {
        nrf_tx_dropped++;
        return 0u;
    }
    for (i = 0u; i < len; i++) {
        nrf_tx_ring[nrf_head] = data[i];
        nrf_head = (uint16_t)((nrf_head + 1u) & NRF_RING_MASK);
    }
    return 1u;
}

static void nrf_kick(void)
{
    uint16_t len;
    if ((nrf_tx_active != 0u) || (nrf_head == nrf_tail)) return;

    len = (uint16_t)((nrf_head - nrf_tail) & NRF_RING_MASK);
    if ((uint16_t)(nrf_tail + len) > (uint16_t)NRF_TX_RING_SIZE) {
        len = (uint16_t)(NRF_TX_RING_SIZE - nrf_tail);
    }

    nrf_tx_len = len;
    nrf_tx_active = 1u;
    if (HAL_UART_Transmit_DMA(nrf_uart, &nrf_tx_ring[nrf_tail], len) != HAL_OK) {
        nrf_tx_active = 0u;
        nrf_tx_dropped++;
    }
}

void Nrf_Init(UART_HandleTypeDef *huart)
{
    nrf_uart = huart;
    nrf_head = nrf_tail = 0u;
    nrf_tx_active = 0u;
    nrf_seq = 0u;
    nrf_tx_dropped = 0u;
    nrf_rx_events = 0u;

    HAL_NVIC_SetPriority(USART1_IRQn, 6u, 0u);
    HAL_NVIC_EnableIRQ(USART1_IRQn);

    if (HAL_UARTEx_ReceiveToIdle_DMA(nrf_uart, nrf_rx_buf, NRF_RX_BUF_SIZE) != HAL_OK) {
        /* RX is optional for the sensor uplink; keep TX working */
    }
    nrf_kick();
}

void Nrf_Poll(void)
{
    nrf_kick();
}

uint8_t Nrf_SendFrame(uint8_t type, const uint8_t *payload, uint16_t len)
{
    uint16_t crc;
    uint16_t total;

    if (len > 1008u) return 0u;

    nrf_frame[0] = 0xAAu;
    nrf_frame[1] = 0x55u;
    nrf_frame[2] = 0x01u;               /* version */
    nrf_frame[3] = type;
    nrf_frame[4] = nrf_seq++;
    nrf_frame[5] = (uint8_t)(len & 0xFFu);
    nrf_frame[6] = (uint8_t)(len >> 8);
    if (len > 0u) {
        memcpy(&nrf_frame[7], payload, len);
    }
    crc = crc16_ccitt(&nrf_frame[2], (uint16_t)(5u + len));
    nrf_frame[7u + len] = (uint8_t)(crc & 0xFFu);
    nrf_frame[8u + len] = (uint8_t)(crc >> 8);
    total = (uint16_t)(9u + len);

    if (!ring_write(nrf_frame, total)) return 0u;
    nrf_kick();
    return 1u;
}

uint8_t Nrf_SendPPG(const ppg_sample_t *samples, uint16_t n)
{
    uint16_t i;
    uint16_t len = 0u;

    if (samples == NULL) return 0u;
    if (n > NRF_MAX_PPG_SAMPLES) n = NRF_MAX_PPG_SAMPLES;

    for (i = 0u; i < n; i++) {
        /* 18-bit red/ir, big-endian, matching the sensor FIFO format */
        nrf_payload[len++] = (uint8_t)((samples[i].red >> 16) & 0x03u);
        nrf_payload[len++] = (uint8_t)((samples[i].red >> 8) & 0xFFu);
        nrf_payload[len++] = (uint8_t)(samples[i].red & 0xFFu);
        nrf_payload[len++] = (uint8_t)((samples[i].ir >> 16) & 0x03u);
        nrf_payload[len++] = (uint8_t)((samples[i].ir >> 8) & 0xFFu);
        nrf_payload[len++] = (uint8_t)(samples[i].ir & 0xFFu);
    }
    return Nrf_SendFrame(NRF_FRAME_TYPE_PPG_RAW, nrf_payload, len);
}

uint8_t Nrf_SendIMU(const mpu6886_raw_t *records, uint16_t n)
{
    uint16_t i;
    uint16_t len = 0u;

    if (records == NULL) return 0u;
    if (n > NRF_MAX_IMU_RECORDS) n = NRF_MAX_IMU_RECORDS;

    for (i = 0u; i < n; i++) {
        const mpu6886_raw_t *r = &records[i];
        nrf_payload[len++] = (uint8_t)((uint16_t)r->ax >> 8);
        nrf_payload[len++] = (uint8_t)(r->ax & 0xFF);
        nrf_payload[len++] = (uint8_t)((uint16_t)r->ay >> 8);
        nrf_payload[len++] = (uint8_t)(r->ay & 0xFF);
        nrf_payload[len++] = (uint8_t)((uint16_t)r->az >> 8);
        nrf_payload[len++] = (uint8_t)(r->az & 0xFF);
        nrf_payload[len++] = (uint8_t)((uint16_t)r->temp >> 8);
        nrf_payload[len++] = (uint8_t)(r->temp & 0xFF);
        nrf_payload[len++] = (uint8_t)((uint16_t)r->gx >> 8);
        nrf_payload[len++] = (uint8_t)(r->gx & 0xFF);
        nrf_payload[len++] = (uint8_t)((uint16_t)r->gy >> 8);
        nrf_payload[len++] = (uint8_t)(r->gy & 0xFF);
        nrf_payload[len++] = (uint8_t)((uint16_t)r->gz >> 8);
        nrf_payload[len++] = (uint8_t)(r->gz & 0xFF);
    }
    return Nrf_SendFrame(NRF_FRAME_TYPE_IMU_RAW, nrf_payload, len);
}

uint8_t Nrf_SendECG(const uint16_t *samples, uint16_t n)
{
    uint16_t i;
    uint16_t len = 0u;

    if (samples == NULL) return 0u;
    if (n > NRF_MAX_ECG_SAMPLES) n = NRF_MAX_ECG_SAMPLES;

    for (i = 0u; i < n; i++) {
        /* raw 12-bit codes, big-endian */
        nrf_payload[len++] = (uint8_t)(samples[i] >> 8);
        nrf_payload[len++] = (uint8_t)(samples[i] & 0xFFu);
    }
    return Nrf_SendFrame(NRF_FRAME_TYPE_ECG_RAW, nrf_payload, len);
}

uint8_t Nrf_SendText(const char *text)
{
    if (text == NULL) return 0u;
    return Nrf_SendFrame(NRF_FRAME_TYPE_TEXT, (const uint8_t *)text,
                         (uint16_t)strlen(text));
}

uint32_t Nrf_TxDropped(void)
{
    return nrf_tx_dropped;
}

uint32_t Nrf_RxEvents(void)
{
    return nrf_rx_events;
}

/* ----------------------------- DMA callbacks ---------------------------- */

void HAL_UART_TxCpltCallback(UART_HandleTypeDef *huart)
{
    if ((nrf_uart != NULL) && (huart->Instance == nrf_uart->Instance)) {
        nrf_tail = (uint16_t)((nrf_tail + nrf_tx_len) & NRF_RING_MASK);
        nrf_tx_active = 0u;
        nrf_kick();
        return;
    }
    Console_OnTxCplt(huart);   /* LPUART1 debug console */
}

void HAL_UART_ErrorCallback(UART_HandleTypeDef *huart)
{
    if ((nrf_uart == NULL) || (huart->Instance != nrf_uart->Instance)) return;
    nrf_tx_active = 0u;
    (void)HAL_UARTEx_ReceiveToIdle_DMA(nrf_uart, nrf_rx_buf, NRF_RX_BUF_SIZE);
    nrf_kick();
}

void HAL_UARTEx_RxEventCallback(UART_HandleTypeDef *huart, uint16_t Size)
{
    (void)Size;
    if ((nrf_uart == NULL) || (huart->Instance != nrf_uart->Instance)) return;
    nrf_rx_events++;
    (void)HAL_UARTEx_ReceiveToIdle_DMA(nrf_uart, nrf_rx_buf, NRF_RX_BUF_SIZE);
}
