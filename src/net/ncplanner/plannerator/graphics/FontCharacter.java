package net.ncplanner.plannerator.graphics;

import static org.lwjgl.opengl.GL30.*;
import org.lwjgl.stb.STBTTAlignedQuad;
import static org.lwjgl.stb.STBTruetype.*;

/** A glyph mesh, backed by the shared ASCII atlas or a generated glyph texture. */
public class FontCharacter{
    private final Font font;
    private final char c;
    public float dx, dy;
    private int vao, ivao;
    private final int texture;
    private static final float margin = 1/10000f;

    public FontCharacter(Font font, char c){
        this.font = font;
        this.c = c;
        texture = font.texture;
        STBTTAlignedQuad quad = STBTTAlignedQuad.create();
        float[] xpos = new float[1];
        float[] ypos = new float[1];
        stbtt_GetBakedQuad(font.charBuffer, font.bitmapSize, font.bitmapSize, c, xpos, ypos, quad, true);
        init(quad.x0(), quad.y0(), quad.x1(), quad.y1(), quad.s0()+margin, quad.t0()+margin, quad.s1()-margin, quad.t1()-margin, xpos[0]);
        initItalic(.25f, quad.x0(), quad.y0(), quad.x1(), quad.y1(), quad.s0()+margin, quad.t0()+margin, quad.s1()-margin, quad.t1()-margin, xpos[0]);
    }

    FontCharacter(Font font, char c, int texture, int xOffset, int yOffset, int width, int height, int advance, float metricScale){
        this.font = font;
        this.c = c;
        this.texture = texture;
        init(xOffset*metricScale, yOffset*metricScale, (xOffset+width)*metricScale, (yOffset+height)*metricScale, 0, 0, 1, 1, advance*metricScale);
        initItalic(.25f, xOffset*metricScale, yOffset*metricScale, (xOffset+width)*metricScale, (yOffset+height)*metricScale, 0, 0, 1, 1, advance*metricScale);
    }

    private void init(float x0, float y0, float x1, float y1, float s0, float t0, float s1, float t1, float advance){
        vao = glGenVertexArrays();
        int vbo = glGenBuffers();
        int ebo = glGenBuffers();
        dx = advance;
        dy = 0;
        float[] vertices = new float[]{
            x0/font.height, y1/font.height+font.yOff, 0, 0, 0, 0, s0, t1,
            x0/font.height, y0/font.height+font.yOff, 0, 0, 0, 0, s0, t0,
            x1/font.height, y1/font.height+font.yOff, 0, 0, 0, 0, s1, t1,
            x1/font.height, y0/font.height+font.yOff, 0, 0, 0, 0, s1, t0
        };
        upload(vao, vbo, ebo, vertices);
    }

    private void initItalic(float tilt, float x0, float y0, float x1, float y1, float s0, float t0, float s1, float t1, float advance){
        ivao = glGenVertexArrays();
        int vbo = glGenBuffers();
        int ebo = glGenBuffers();
        dx = advance;
        dy = 0;
        float[] vertices = new float[]{
            x0/font.height+tilt, -y0/font.height, 0, 0, 0, 0, s0, t1,
            x0/font.height, -y1/font.height, 0, 0, 0, 0, s0, t0,
            x1/font.height+tilt, -y0/font.height, 0, 0, 0, 0, s1, t1,
            x1/font.height, -y1/font.height, 0, 0, 0, 0, s1, t0
        };
        upload(ivao, vbo, ebo, vertices);
    }

    private static void upload(int vao, int vbo, int ebo, float[] vertices){
        int[] indices = new int[]{1, 0, 2, 3, 1, 2};
        glBindVertexArray(vao);
        glBindBuffer(GL_ARRAY_BUFFER, vbo);
        glBufferData(GL_ARRAY_BUFFER, vertices, GL_STATIC_DRAW);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ebo);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, indices, GL_STATIC_DRAW);
        glEnableVertexAttribArray(0);
        glVertexAttribPointer(0, 3, GL_FLOAT, false, 8*4, 0);
        glEnableVertexAttribArray(1);
        glVertexAttribPointer(1, 3, GL_FLOAT, false, 8*4, 3*4);
        glEnableVertexAttribArray(2);
        glVertexAttribPointer(2, 2, GL_FLOAT, false, 8*4, 6*4);
        glBindVertexArray(0);
    }

    public void draw(){
        glBindTexture(GL_TEXTURE_2D, texture);
        glBindVertexArray(vao);
        glDrawElements(GL_TRIANGLES, 6, GL_UNSIGNED_INT, 0);
        glBindVertexArray(0);
    }

    public void drawItalic(){
        glBindTexture(GL_TEXTURE_2D, texture);
        glBindVertexArray(ivao);
        glDrawElements(GL_TRIANGLES, 6, GL_UNSIGNED_INT, 0);
        glBindVertexArray(0);
    }
}
