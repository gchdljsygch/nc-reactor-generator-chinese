package net.ncplanner.plannerator.graphics;
import java.nio.ByteBuffer;
import java.util.HashMap;
import net.ncplanner.plannerator.planner.Core;
import org.lwjgl.BufferUtils;
import org.lwjgl.stb.STBTTBakedChar;
import org.lwjgl.stb.STBTTFontinfo;
import org.lwjgl.stb.STBTruetype;
import static org.lwjgl.opengl.GL11.*;
import static org.lwjgl.opengl.GL12.GL_CLAMP_TO_EDGE;
import static org.lwjgl.opengl.GL30.glGenerateMipmap;
public class Font{
    public int texture;
    public int ascent, descent, lineGap;
    public final STBTTBakedChar.Buffer charBuffer;
    public final float yOff;
    public final float height;
    public final int bitmapSize;
    private HashMap<Character, FontCharacter> characters = new HashMap<>();
    private final STBTTFontinfo info;
    private final ByteBuffer fontData;
    private final float scale;
    public Font(STBTTFontinfo info, ByteBuffer fontData, int texture, STBTTBakedChar.Buffer charBuffer, float yOff, float height, int bitmapSize){
        this.info = info;
        this.fontData = fontData;
        this.texture = texture;
        int[] ascent = new int[1];
        int[] descent = new int[1];
        int[] lineGap = new int[1];
        STBTruetype.stbtt_GetFontVMetrics(info, ascent, descent, lineGap);
        this.ascent = ascent[0];
        this.descent = descent[0];
        this.lineGap = lineGap[0];
        this.charBuffer = charBuffer;
        this.yOff = yOff;
        this.height = height;
        this.bitmapSize = bitmapSize;
        scale = STBTruetype.stbtt_ScaleForPixelHeight(info, height);
        initCharacters();
    }
    private static final int fontHeight = 512;
    private static final int dynamicGlyphHeight = 256;
    private static final float dynamicGlyphSize = .92f;
    private static final int dynamicGlyphWeight = 1;
    private static final float glyphGamma = .65f;
    public static Font loadFont(String name){
        return loadFont(name, 0);
    }
    public static Font loadFont(String name, float yOff){
        return loadFont(name, yOff, fontHeight, fontHeight*8);
    }
    public static Font loadFont(String name, float yOff, float height, int bitmapSize){
        ByteBuffer fontData = Core.loadData("/fonts/"+name+".ttf");
        ByteBuffer buffer = BufferUtils.createByteBuffer(bitmapSize*bitmapSize);
        STBTTFontinfo info = STBTTFontinfo.create();
        if(!STBTruetype.stbtt_InitFont(info, fontData, 0))throw new RuntimeException("Failed to initialize font! ("+name+")");
        STBTTBakedChar.Buffer charBuffer = STBTTBakedChar.create(255);
        STBTruetype.stbtt_BakeFontBitmap(fontData, height, buffer, bitmapSize, bitmapSize, 0, charBuffer);
        int texture = uploadFontTexture(bitmapSize, bitmapSize, buffer);
        return new Font(info, fontData, texture, charBuffer, yOff, height, bitmapSize);
    }
    public void initCharacters(){
        for(char c = ' '; c<='~'; c++){
            characters.put(c, new FontCharacter(this, c));
        }
    }
    public float getStringWidth(String str, float height){
        float width = 0;
        for(char c : str.toCharArray()){
            FontCharacter character = getCharacter(c);
            if(character!=null)width+=character.dx/this.height;
        }
        return width*height;
    }
    public FontCharacter getCharacter(char c){
        FontCharacter character = characters.get(c);
        if(character!=null)return character;
        if(STBTruetype.stbtt_FindGlyphIndex(info, c)==0)return characters.get('?');
        character = createDynamicCharacter(c);
        characters.put(c, character);
        return character;
    }
    private FontCharacter createDynamicCharacter(char c){
        int[] width = new int[1];
        int[] glyphHeight = new int[1];
        int[] xOffset = new int[1];
        int[] yOffset = new int[1];
        float glyphScale = STBTruetype.stbtt_ScaleForPixelHeight(info, dynamicGlyphHeight);
        ByteBuffer bitmap = STBTruetype.stbtt_GetCodepointBitmap(info, glyphScale, glyphScale, c, width, glyphHeight, xOffset, yOffset);
        int[] advanceWidth = new int[1];
        int[] leftSideBearing = new int[1];
        STBTruetype.stbtt_GetCodepointHMetrics(info, c, advanceWidth, leftSideBearing);
        int glyphTexture = createGlyphTexture(bitmap, width[0], glyphHeight[0], dynamicGlyphWeight);
        if(bitmap!=null)STBTruetype.stbtt_FreeBitmap(bitmap);
        float metricScale = this.height/dynamicGlyphHeight*dynamicGlyphSize;
        return new FontCharacter(this, c, glyphTexture, xOffset[0]-dynamicGlyphWeight, yOffset[0]-dynamicGlyphWeight, width[0]+dynamicGlyphWeight*2, glyphHeight[0]+dynamicGlyphWeight*2, Math.round(advanceWidth[0]*glyphScale), metricScale);
    }
    private int createGlyphTexture(ByteBuffer bitmap, int width, int glyphHeight, int weight){
        if(bitmap==null||width<=0||glyphHeight<=0){
            ByteBuffer transparent = BufferUtils.createByteBuffer(4);
            return uploadGlyphTexture(1, 1, transparent);
        }
        int textureWidth = width+weight*2;
        int textureHeight = glyphHeight+weight*2;
        ByteBuffer rgba = BufferUtils.createByteBuffer(textureWidth*textureHeight*4);
        for(int y = 0; y<textureHeight; y++){
            for(int x = 0; x<textureWidth; x++){
                int alpha = 0;
                for(int sampleY = y-weight; sampleY<=y+weight; sampleY++){
                    for(int sampleX = x-weight; sampleX<=x+weight; sampleX++){
                            int bitmapX = sampleX;
                            int bitmapY = sampleY;
                        if(bitmapX>=0&&bitmapX<width&&bitmapY>=0&&bitmapY<glyphHeight){
                            alpha = Math.max(alpha, bitmap.get(bitmapY*width+bitmapX)&0xFF);
                        }
                    }
                }
                int offset = (y*textureWidth+x)*4;
                rgba.put(offset, (byte)255);
                rgba.put(offset+1, (byte)255);
                rgba.put(offset+2, (byte)255);
                rgba.put(offset+3, (byte)Math.round(255*Math.pow(alpha/255f, glyphGamma)));
            }
        }
        return uploadGlyphTexture(textureWidth, textureHeight, rgba);
    }
    private static int uploadFontTexture(int width, int height, ByteBuffer bitmap){
        ByteBuffer rgba = BufferUtils.createByteBuffer(width*height*4);
        for(int i = 0; i<width*height; i++){
            int alpha = bitmap.get(i)&0xFF;
            alpha = (int)Math.round(255*Math.pow(alpha/255f, glyphGamma));
            int offset = i*4;
            rgba.put(offset, (byte)255);
            rgba.put(offset+1, (byte)255);
            rgba.put(offset+2, (byte)255);
            rgba.put(offset+3, (byte)alpha);
        }
        return uploadGlyphTexture(width, height, rgba);
    }
    private static int uploadGlyphTexture(int width, int height, ByteBuffer imageData){
        int texture = glGenTextures();
        glBindTexture(GL_TEXTURE_2D, texture);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, imageData);
        glGenerateMipmap(GL_TEXTURE_2D);
        return texture;
    }
}
