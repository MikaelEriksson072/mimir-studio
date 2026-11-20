// The scenes of fixtures/vsf/vic-*.vsf: each sets up the VIC-II one way and loops. KickAss with :scene=1 … 9.
// 1 vic-sprites: multicolour text, own charset at $3000, 38 x 24, all 8 sprites (multicolour, wide, tall, behind,
//   in the border); 2 vic-bitmap: multicolour bitmap in VIC bank 1 ($6000, screen $5c00), 4 sprites. The others (ECM
//   with the ROM charset, hires bitmap in bank 3, the screen off, an invalid mode, bank 2 with the ROM charset,
//   YSCROLL 7 / XSCROLL 5 with the idle byte and a sprite at x 500, YSCROLL 0) were checked the same way.
.var scene = cmdLineVars.get("scene").asNumber()
BasicUpstart2(start)
*= $0810
start:
    sei
    lda #$7f
    sta $dc0d
    sta $dd0d
    lda $dc0d
    lda $dd0d
    lda #$00
    sta $d01a
.if (scene == 1) {
    fill($3000, 8)      // charset
    fill($0400, 4)      // screen
    fill($d800, 4)      // colour RAM
    fill($2000, 2)      // sprite data $80-$87
    ldx #7
!:  txa
    ora #$80
    sta $07f8,x
    dex
    bpl !-
    vic($1c, $13, $13, 2, 6, 5, 7, 8)
    sprites($ff, %00110000, %00101000, %10001000, %01100000)
    pos(0, 24, 50)
    pos(1, 340, 100)
    pos(2, 0, 30)
    pos(3, 100, 200)
    pos(4, 150, 120)
    pos(5, 200, 60)
    pos(6, 180, 130)
    pos(7, 250, 229)
}
.if (scene == 2) {
    lda $dd02
    ora #$03
    sta $dd02
    lda $dd00
    and #$fc
    ora #$02
    sta $dd00
    fill($6000, 32)
    fill($5c00, 4)
    fill($d800, 4)
    fill($5000, 2)
    ldx #7
!:  txa
    ora #$40
    sta $5ff8,x
    dex
    bpl !-
    vic($78, $3b, $18, 14, 11, 0, 0, 0)
    sprites($0f, %00000101, %00000010, %00001000, %00000100)
    pos(0, 30, 60)
    pos(1, 120, 90)
    pos(2, 200, 150)
    pos(3, 300, 210)
}
.if (scene == 3) {
    fill($0400, 4)
    fill($d800, 4)
    fill($3e00, 1)
    lda #$f8
    sta $07f8
    lda #$f9
    sta $07f9
    vic($17, $5b, $08, 3, 0, 2, 5, 6)
    sprites($03, %00000010, %00000000, %00000000, %00000001)
    pos(0, 160, 140)
    pos(1, 40, 60)
}
.if (scene == 4) {
    lda $dd02
    ora #$03
    sta $dd02
    lda $dd00
    and #$fc
    sta $dd00
    fill($e000, 32)
    fill($c000, 4)
    fill($c400, 2)
    ldx #7
!:  txa
    ora #$10
    sta $c3f8,x
    dex
    bpl !-
    vic($08, $3b, $08, 6, 0, 0, 0, 0)
    sprites($81, %10000000, %00000001, %10000000, %00000000)
    pos(0, 100, 100)
    pos(7, 200, 200)
}
.if (scene == 5) {
    fill($2000, 2)
    lda #$80
    sta $07f8
    vic($15, $0b, $08, 4, 6, 0, 0, 0)
    sprites($01, 0, 0, 0, 0)
    pos(0, 100, 100)
}
.if (scene == 6) {
    fill($0400, 4)
    fill($2000, 8)
    fill($3000, 2)
    lda #$c0
    sta $07f8
    lda #$c1
    sta $07f9
    vic($18, $7b, $18, 5, 6, 0, 0, 0)
    sprites($03, %00000001, 0, 0, %00000010)
    pos(0, 100, 100)
    pos(1, 110, 110)
}
.if (scene == 7) {
    lda $dd02
    ora #$03
    sta $dd02
    lda $dd00
    and #$fc
    ora #$01
    sta $dd00
    fill($8000, 4)
    fill($d800, 4)
    fill($a000, 1)
    lda #$80
    sta $83f8
    vic($04, $1b, $18, 0, 9, 1, 15, 0)
    sprites($01, 1, 0, 0, 0)
    pos(0, 60, 80)
}
.if (scene == 8) {
    fill($0400, 4)
    fill($d800, 4)
    fill($2000, 2)
    lda #$a5
    sta $3fff
    lda #$80
    sta $07f8
    lda #$81
    sta $07f9
    lda #$82
    sta $07fa
    vic($15, $1f, $0d, 2, 6, 0, 0, 0)
    sprites($07, %00000001, 0, %00000001, %00000001)
    pos(0, 40, 45)
    pos(1, 44, 49)
    pos(2, 500, 100)
}
.if (scene == 9) {
    fill($2000, 32)
    fill($0400, 4)
    fill($d800, 4)
    lda #$1b
    sta $3fff
    vic($18, $38, $1f, 7, 0, 0, 0, 0)
    sprites(0, 0, 0, 0, 0)
}
loop: jmp loop

.macro vic(d018, d011, d016, d020, d021, d022, d023, d024) {
    lda #d018
    sta $d018
    lda #d011
    sta $d011
    lda #d016
    sta $d016
    lda #d020
    sta $d020
    lda #d021
    sta $d021
    lda #d022
    sta $d022
    lda #d023
    sta $d023
    lda #d024
    sta $d024
    lda #1
    sta $d025
    lda #9
    sta $d026
    ldx #7
!:  lda colours,x
    sta $d027,x
    dex
    bpl !-
}
.macro sprites(en, mc, ey, ex, pri) {
    lda #en
    sta $d015
    lda #mc
    sta $d01c
    lda #ey
    sta $d017
    lda #ex
    sta $d01d
    lda #pri
    sta $d01b
    lda #0
    sta $d010
}
.macro pos(n, x, y) {
    lda #<x
    sta $d000 + n * 2
    lda #y
    sta $d001 + n * 2
    .if (x > 255) {
        lda $d010
        ora #1 << n
        sta $d010
    }
}
.macro fill(addr, pages) {
    lda #<addr
    sta $fb
    lda #>addr
    sta $fc
    ldx #pages
    jsr fillsub
}
fillsub:
    ldy #0
!:  lda state
    asl
    bcc nx
    eor #$1d
nx: sta state
    eor $fc
    sta ($fb),y
    iny
    bne !-
    inc $fc
    dex
    bne !-
    rts
state: .byte 1
colours: .byte 1, 3, 4, 5, 7, 10, 13, 14
