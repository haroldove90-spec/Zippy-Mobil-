
import React, { useEffect, useRef, useState } from 'react';
import { Crosshair, Loader2 } from 'lucide-react';
import { MapEntity } from '../types';

declare var google: any;

interface MapVisualProps {
  status: string;
  userLocation?: [number, number]; // [lat, lng] Pasajero
  driverLocation?: [number, number]; // [lat, lng] Conductor
  entities?: MapEntity[]; 
  routeStart?: [number, number]; 
  routeEnd?: [number, number];
  gpsAccuracy?: number; // Nueva prop para precisión
}

// Icono de Auto Amarillo Zippy (SVG Path Optimizado)
const CAR_ICON_PATH = "M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-0.66 0-1.21 0.42-1.42 1.01L3 12v8c0 0.55 0.45 1 1 1h1c0.55 0 1-0.45 1-1v-1h12v1c0 0.55 0.45 1 1 1h1c0.55 0 1-0.45 1-1v-8l-2.08-5.99zM6.5 16c-0.83 0-1.5-0.67-1.5-1.5S5.67 13 6.5 13s1.5 0.67 1.5 1.5S7.33 16 6.5 16zM17.5 16c-0.83 0-1.5-0.67-1.5-1.5s0.67-1.5 1.5-1.5 1.5 0.67 1.5 1.5 -0.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z";

const MapVisual: React.FC<MapVisualProps> = ({ status, userLocation, driverLocation, entities, routeStart, routeEnd, gpsAccuracy = 0 }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  
  const userMarkerRef = useRef<any>(null);
  const driverMarkerRef = useRef<any>(null);
  const accuracyCircleRef = useRef<any>(null); 
  const directionsRendererRef = useRef<any>(null);
  const hasCenteredRef = useRef<boolean>(false);
  
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isUserInteracting, setIsUserInteracting] = useState(false);

  // 1. Inicializar Mapa
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    if (typeof google === 'undefined') {
        console.error("Google Maps SDK no cargado.");
        return;
    }

    const defaultCenter = { lat: 19.4326, lng: -99.1332 };

    const map = new google.maps.Map(mapContainerRef.current, {
        center: defaultCenter,
        zoom: 15,
        disableDefaultUI: true,
        zoomControl: false,
        clickableIcons: false,
        gestureHandling: 'greedy', 
        styles: [
            { "featureType": "poi", "elementType": "labels", "stylers": [{ "visibility": "off" }] },
            { "featureType": "transit", "elementType": "labels", "stylers": [{ "visibility": "off" }] }
        ]
    });

    mapInstanceRef.current = map;

    map.addListener('dragstart', () => setIsUserInteracting(true));
    map.addListener('zoom_changed', () => setIsUserInteracting(true));

    const renderer = new google.maps.DirectionsRenderer({
        map: map,
        suppressMarkers: true,
        preserveViewport: true, 
        polylineOptions: {
            strokeColor: '#003A70', 
            strokeWeight: 6,
            strokeOpacity: 0.8
        }
    });
    directionsRendererRef.current = renderer;

    setMapLoaded(true);
  }, []);

  // 2. Marcador del Usuario Principal (Depende del Rol)
  useEffect(() => {
      if (!mapInstanceRef.current || !mapLoaded) return;
      if (!userLocation) return;

      const pos = { lat: userLocation[0], lng: userLocation[1] };
      
      // Si driverLocation es idéntico a userLocation, asumimos que es la vista del Conductor
      // O si driverLocation no está definido, asumimos vista Pasajero inicial
      const isDriverView = userLocation === driverLocation;

      // Icono: Auto Amarillo para Conductor, Punto Azul para Pasajero
      const iconConfig = isDriverView ? {
          path: CAR_ICON_PATH,
          scale: 2, 
          fillColor: "#FDCA01", // AMARILLO ZIPPY
          fillOpacity: 1,
          strokeWeight: 2,
          strokeColor: "#000000",
          anchor: new google.maps.Point(12, 12)
      } : {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "#4285F4",
          fillOpacity: 1,
          strokeColor: "white",
          strokeWeight: 2,
      };

      if (!userMarkerRef.current) {
          userMarkerRef.current = new google.maps.Marker({
              position: pos,
              map: mapInstanceRef.current,
              icon: iconConfig,
              zIndex: 100,
              title: "Tú"
          });
      } else {
          userMarkerRef.current.setPosition(pos);
          userMarkerRef.current.setIcon(iconConfig);
      }

      // Círculo de Precisión (Solo útil para ver radio de GPS)
      if (!accuracyCircleRef.current) {
          accuracyCircleRef.current = new google.maps.Circle({
              strokeColor: "#4285F4",
              strokeOpacity: 0.4,
              strokeWeight: 1,
              fillColor: "#4285F4",
              fillOpacity: 0.15,
              map: mapInstanceRef.current,
              center: pos,
              radius: gpsAccuracy
          });
      } else {
          accuracyCircleRef.current.setCenter(pos);
          accuracyCircleRef.current.setRadius(gpsAccuracy);
      }
      
      // Centrado Inicial
      if (!hasCenteredRef.current) {
          mapInstanceRef.current.panTo(pos);
          mapInstanceRef.current.setZoom(16);
          hasCenteredRef.current = true;
      }

  }, [userLocation, gpsAccuracy, mapLoaded, isUserInteracting, driverLocation]);

  // 3. Marcador del "Otro" (El Taxi que ve el Pasajero)
  useEffect(() => {
      if (!mapInstanceRef.current || !mapLoaded) return;

      // Solo dibujar este marcador si NO somos el conductor (user != driver)
      if (userLocation === driverLocation) return; 

      if (driverLocation && driverLocation[0] !== 0) {
          const pos = { lat: driverLocation[0], lng: driverLocation[1] };
          
          if (!driverMarkerRef.current) {
              driverMarkerRef.current = new google.maps.Marker({
                  position: pos,
                  map: mapInstanceRef.current,
                  icon: {
                      path: CAR_ICON_PATH,
                      scale: 2, // TAXI AMARILLO GRANDE
                      fillColor: "#FDCA01", 
                      fillOpacity: 1,
                      strokeWeight: 2,
                      strokeColor: "#000000",
                      anchor: new google.maps.Point(12, 12)
                  },
                  zIndex: 200, // Encima del punto azul
                  title: "Tu Zippy"
              });
          } else {
              driverMarkerRef.current.setPosition(pos);
              if (!driverMarkerRef.current.getMap()) driverMarkerRef.current.setMap(mapInstanceRef.current);
          }
      } else {
          if (driverMarkerRef.current) driverMarkerRef.current.setMap(null);
      }
  }, [driverLocation, userLocation, mapLoaded]);

  // 4. Ruta
  useEffect(() => {
      if (!mapInstanceRef.current || !mapLoaded || !routeStart || !routeEnd) {
          if (directionsRendererRef.current) directionsRendererRef.current.setDirections({ routes: [] });
          return;
      }

      const directionsService = new google.maps.DirectionsService();

      directionsService.route({
          origin: { lat: routeStart[0], lng: routeStart[1] },
          destination: { lat: routeEnd[0], lng: routeEnd[1] },
          travelMode: google.maps.TravelMode.DRIVING
      }, (result: any, status: any) => {
          if (status === google.maps.DirectionsStatus.OK) {
              directionsRendererRef.current.setDirections(result);
          }
      });
  }, [routeStart, routeEnd, mapLoaded]);

  // 5. Auto-Zoom Dinámico
  useEffect(() => {
      if (!mapInstanceRef.current || !mapLoaded || isUserInteracting) return;

      const bounds = new google.maps.LatLngBounds();
      let points = 0;

      if (userLocation) {
          bounds.extend({ lat: userLocation[0], lng: userLocation[1] });
          points++;
      }
      
      if (driverLocation && driverLocation[0] !== 0 && (status === 'ACCEPTED' || status === 'ARRIVED' || status === 'IN_PROGRESS')) {
          bounds.extend({ lat: driverLocation[0], lng: driverLocation[1] });
          points++;
      }

      if (routeEnd && (status === 'REQUESTING' || status === 'IN_PROGRESS' || status === 'ACCEPTED')) {
          bounds.extend({ lat: routeEnd[0], lng: routeEnd[1] });
          points++;
      }

      if (points > 1) {
          mapInstanceRef.current.fitBounds(bounds, {
              top: 100, right: 50, bottom: 200, left: 50
          });
      }

  }, [userLocation, driverLocation, routeEnd, status, mapLoaded, isUserInteracting]);

  const handleRecenter = () => {
      setIsUserInteracting(false);
      if (mapInstanceRef.current && userLocation) {
          mapInstanceRef.current.panTo({ lat: userLocation[0], lng: userLocation[1] });
          mapInstanceRef.current.setZoom(17);
      }
  };

  return (
    <div className="absolute inset-0 w-full h-full z-0">
        <div ref={mapContainerRef} className="w-full h-full bg-gray-100" />
        
        {!mapLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-20">
                <div className="flex flex-col items-center">
                    <Loader2 className="animate-spin text-zippy-dark w-10 h-10 mb-2" />
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest animate-pulse">
                        Cargando Mapa...
                    </p>
                </div>
            </div>
        )}

        {mapLoaded && userLocation && (status !== 'ADMIN') && (
            <button 
                onClick={handleRecenter}
                className="absolute right-4 bottom-32 z-[1] p-3 bg-white text-zippy-dark rounded-full shadow-xl border border-gray-200 active:scale-95 transition-transform"
                title="Mi Ubicación"
            >
                <Crosshair className="w-6 h-6" />
            </button>
        )}
        
        <div className="absolute bottom-0 left-0 w-full h-24 bg-gradient-to-t from-white/90 to-transparent pointer-events-none z-0"></div>
    </div>
  );
};

export default MapVisual;
