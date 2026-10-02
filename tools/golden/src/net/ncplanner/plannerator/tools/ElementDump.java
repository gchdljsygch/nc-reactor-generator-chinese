package net.ncplanner.plannerator.tools;

import java.io.BufferedWriter;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

import net.ncplanner.plannerator.ncpf.NCPFElement;
import net.ncplanner.plannerator.ncpf.configuration.NCPFConfiguration;
import net.ncplanner.plannerator.planner.ncpf.Addon;
import net.ncplanner.plannerator.planner.ncpf.Configuration;

/**
 * R0.5 support — dumps every NCPF element in every loaded configuration with its
 * <em>language-independent identity</em> plus its canonical English names.
 *
 * <p>This is the key input for separating "data names" from "UI messages" when
 * migrating the legacy translation table:
 *
 * <pre>
 * identity = definition.type + "|" + definition.toString()
 * </pre>
 *
 * <p>{@code definition.toString()} for e.g. a legacy block element renders the
 * namespaced id plus metadata/blockstate/nbt, which is stable across languages.
 * The rewrite's {@code DataNameBundle} is keyed by exactly this string (see
 * docs/rewrite-plan.md §4.4).
 *
 * <p>Output is JSONL, one object per element:
 * <pre>
 * {"config":"default","cfgType":"nuclearcraft:overhaul_sfr","src":"config|addon",
 *  "type":"legacy_block","def":"nuclearcraft:solid_fission_controller",
 *  "identity":"legacy_block|nuclearcraft:solid_fission_controller",
 *  "display":"Solid Fission Controller","legacy":["Solid Fission Controller"]}
 * </pre>
 *
 * Usage: {@code ElementDump <out.jsonl>}
 */
public class ElementDump{
    public static void main(String[] args) throws Exception{
        if(args.length<1){
            System.err.println("usage: ElementDump <out.jsonl>");
            System.exit(2);
        }
        Bootstrap.init();
        Configuration nc = Configuration.NUCLEARCRAFT;

        int count = 0;
        int distinctIdentity = 0;
        LinkedHashSet<String> identities = new LinkedHashSet<>();
        // legacy i18n audit counters
        int fullyTranslated = 0;
        int partiallyTranslated = 0;
        int untouched = 0;
        List<String> partialSamples = new ArrayList<>();
        List<String> untouchedSamples = new ArrayList<>();

        try(BufferedWriter w = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(args[0]), StandardCharsets.UTF_8))){
            w.write("{\"__meta\":{\"tool\":\"ElementDump\",\"config\":\"nuclearcraft.ncpf.json\"}}\n");

            // --- the main configuration -------------------------------------
            for(NCPFConfiguration cfg : nc.configuration.configurations.values()){
                for(List<NCPFElement> list : cfg.getAllElementsISaidAllElements()){
                    for(NCPFElement e : list){
                        String json = toJson(nc.getName(), cfg.getName(), "config", e);
                        if(json==null)continue;
                        w.write(json);
                        w.write('\n');
                        count++;
                        if(identities.add(identify(e)))distinctIdentity++;
                        String display = safeDisplay(e);
                        int verdict = audit(display);
                        if(verdict==0)fullyTranslated++;
                        else if(verdict==1){
                            partiallyTranslated++;
                            if(partialSamples.size()<30)partialSamples.add(display+"  ==>  "+localize(display));
                        }else{
                            untouched++;
                            if(untouchedSamples.size()<30)untouchedSamples.add(display);
                        }
                    }
                }
            }

            // --- bundled addons ---------------------------------------------
            int addonCount = 0;
            for(Addon a : nc.addons){
                for(NCPFConfiguration cfg : a.configuration.configurations.values()){
                    for(List<NCPFElement> list : cfg.getAllElementsISaidAllElements()){
                        for(NCPFElement e : list){
                            String json = toJson(a.getName(), cfg.getName(), "addon", e);
                            if(json==null)continue;
                            w.write(json);
                            w.write('\n');
                            count++;
                            addonCount++;
                            if(identities.add(identify(e)))distinctIdentity++;
                        }
                    }
                }
            }
            System.out.println("elements written      : "+count);
            System.out.println("  from addons         : "+addonCount);
            System.out.println("distinct identities   : "+distinctIdentity);
            System.out.println();
            System.out.println("--- legacy i18n audit over element display names ---");
            System.out.println("fully translated      : "+fullyTranslated);
            System.out.println("partially translated  : "+partiallyTranslated);
            System.out.println("untouched (english)   : "+untouched);
            System.out.println("total                 : "+(fullyTranslated+partiallyTranslated+untouched));
            System.out.println();
            System.out.println("--- partially translated samples (mixed CN/EN on screen) ---");
            for(String s : partialSamples)System.out.println("  "+s);
            System.out.println();
            System.out.println("--- untouched samples (shown in English) ---");
            for(String s : untouchedSamples)System.out.println("  "+s);
        }
        System.out.println("output                : "+args[0]);
    }

    private static String identify(NCPFElement e){
        return e.definition.type+"|"+e.definition.toString();
    }

    private static String safeDisplay(NCPFElement e){
        try{
            String d = e.getDisplayName();
            return d==null?"":d;
        }catch(Throwable t){
            return "";
        }
    }

    /** 0 = fully translated, 1 = mixed CN/EN, 2 = untouched */
    private static int audit(String text){
        if(text.isEmpty())return 2;
        String localized = localize(text);
        if(localized.equals(text))return 2;
        for(int i = 0; i<localized.length(); i++){
            char c = localized.charAt(i);
            if((c>='A'&&c<='Z')||(c>='a'&&c<='z'))return 1;
        }
        return 0;
    }

    private static String localize(String text){
        try{
            return net.ncplanner.plannerator.planner.localization.Localization.localize(text);
        }catch(Throwable t){
            return text;
        }
    }

    private static String toJson(String config, String cfgType, String src, NCPFElement e){
        String identity;
        String def;
        try{
            def = e.definition.toString();
            identity = identify(e);
        }catch(Throwable t){
            return null;// some definitions can't stringify without references
        }
        List<String> legacy = new ArrayList<>();
        try{
            legacy.addAll(e.getLegacyNames());
        }catch(Throwable t){
            // ignore — legacy names are best-effort
        }
        String display;
        try{
            display = e.getDisplayName();
        }catch(Throwable t){
            display = null;
        }
        StringBuilder sb = new StringBuilder(192);
        sb.append("{\"config\":\"").append(esc(config)).append('"');
        sb.append(",\"cfgType\":\"").append(esc(cfgType)).append('"');
        sb.append(",\"src\":\"").append(src).append('"');
        sb.append(",\"type\":\"").append(esc(e.definition.type)).append('"');
        sb.append(",\"def\":\"").append(esc(def)).append('"');
        sb.append(",\"identity\":\"").append(esc(identity)).append('"');
        sb.append(",\"display\":").append(display==null?"null":"\""+esc(display)+"\"");
        sb.append(",\"legacy\":[");
        for(int i = 0; i<legacy.size(); i++){
            if(i>0)sb.append(',');
            sb.append('"').append(esc(legacy.get(i))).append('"');
        }
        sb.append("]}");
        return sb.toString();
    }

    private static String esc(String s){
        if(s==null)return "";
        StringBuilder sb = new StringBuilder(s.length()+8);
        for(int i = 0; i<s.length(); i++){
            char c = s.charAt(i);
            switch(c){
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if(c<0x20)sb.append(String.format("\\u%04x", (int)c));
                    else sb.append(c);
            }
        }
        return sb.toString();
    }
}
